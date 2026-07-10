import { AtpAgent } from "@atproto/api"
import sodium from "libsodium-wrappers"
export type SharedSessionMessageRole = "user" | "assistant"

export interface SharedSessionSkillCall {
  name: string
  params: string
}

export interface SharedSessionMessage {
  role: SharedSessionMessageRole
  content: string
  skillCall?: SharedSessionSkillCall
  model?: string
}

export interface SharedSession {
  sessionId: string
  name: string
  isPrivateLink: boolean
  createdAt: string | null
  sourceUri: string
  modelsUsed: string[]
  sharedBy: {
    did: string
    handle: string | null
    displayName: string | null
    avatarUrl: string | null
  }
  messages: SharedSessionMessage[]
}

export function isEncryptedSharedSessionRecord(
  record: Record<string, unknown>,
): boolean {
  return typeof record.enc_content === "string" && record.enc_content.length > 0
}

interface AtUriParts {
  repo: string
  collection: string
  rkey: string
}

const DEFAULT_ATPROTO_SERVICE = "https://public.api.bsky.app"
const PLC_DIRECTORY_URL = "https://plc.directory"
const TILES_SESSION_COLLECTION = "run.tiles.session"
const TILES_CHAT_SESSION_SNAPSHOT_COLLECTION =
  "run.tiles.chat.sessionSnapshot"
const TILES_SHARED_SESSION_COLLECTIONS = new Set([
  TILES_SESSION_COLLECTION,
  TILES_CHAT_SESSION_SNAPSHOT_COLLECTION,
])
const DEFAULT_TILES_SESSION_REPO =
  process.env.TILES_DEFAULT_SHARE_REPO ?? "did:plc:mbk6wgmxiatotzy5b3q57naw"

export function createSharedSessionPathFromUri(uri: string): string {
  const { repo, collection } = parseAtUri(uri)

  if (
    repo !== DEFAULT_TILES_SESSION_REPO ||
    !TILES_SHARED_SESSION_COLLECTIONS.has(collection)
  ) {
    throw new Error(
      "Short share URLs only support configured Tiles shared session records.",
    )
  }

  const base64UrlToken = Buffer.from(uri, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "")

  return `/${base64UrlToken}`
}

export function resolveSharedSessionUri(shareToken: string): string {
  const token = decodeURIComponent(shareToken)
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/api\/og$/i, "")
  const normalizedToken = token.replace(/-/g, "+").replace(/_/g, "/")
  const paddedToken = normalizedToken.padEnd(
    normalizedToken.length + ((4 - (normalizedToken.length % 4)) % 4),
    "=",
  )
  const decodedText = Buffer.from(paddedToken, "base64").toString("utf8").trim()
  const decodedUri = decodedText.startsWith("at://")
    ? decodedText
    : `at://${decodedText.replace(/^\/+/, "")}`

  if (!decodedUri.startsWith("at://")) {
    throw new Error("Shared session token must be a base64 AT URI.")
  }

  const { collection } = parseAtUri(decodedUri)

  if (!TILES_SHARED_SESSION_COLLECTIONS.has(collection)) {
    throw new Error("Shared session URI is not a Tiles shared session record.")
  }

  return decodedUri
}

function parseAtUri(uri: string): AtUriParts {
  const match = uri.match(/^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/)

  if (!match) {
    throw new Error(
      "Shared session URI must look like at://repo/collection/rkey.",
    )
  }

  return {
    repo: match[1],
    collection: match[2],
    rkey: match[3],
  }
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null
}

function normalizeModelsUsed(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((entry) => {
    const model = readString(entry)
    return model ? [model] : []
  })
}

function noStoreFetch(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
) {
  return fetch(input, {
    ...init,
    cache: "no-store",
  })
}

function decodeXmlAttribute(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
}

function parseDirectSkillCall(content: string): SharedSessionSkillCall | null {
  const skillTagMatch = content.match(
    /^\s*<skill\b([^>]*)>[\s\S]*?<\/skill>\s*/i,
  )

  if (!skillTagMatch) {
    return null
  }

  const nameMatch = skillTagMatch[1].match(/\sname=(["'])(.*?)\1/i)
  const name = nameMatch?.[2] ? decodeXmlAttribute(nameMatch[2]).trim() : ""

  if (!name) {
    return null
  }

  return {
    name,
    params: content.slice(skillTagMatch[0].length).trim(),
  }
}

function normalizeMessage(
  role: SharedSessionMessageRole,
  content: string,
  shouldParseDirectSkillCall: boolean,
): SharedSessionMessage {
  const directSkillCall = shouldParseDirectSkillCall
    ? parseDirectSkillCall(content)
    : null

  if (!directSkillCall) {
    return { role, content }
  }

  return {
    role,
    content: directSkillCall.params,
    skillCall: directSkillCall,
  }
}

function normalizeMessages(contents: unknown): SharedSessionMessage[] {
  if (!Array.isArray(contents)) {
    return []
  }

  return contents.flatMap((entry): SharedSessionMessage[] => {
    if (!entry || typeof entry !== "object") {
      return []
    }

    const record = entry as Record<string, unknown>
    const role = record.role
    const content = readString(record.content)

    if ((role === "user" || role === "assistant") && content) {
      const message = normalizeMessage(
        role,
        content,
        role === "user",
      )

      return [message]
    }

    const userContent = readString(record.user)
    const assistantContent = readString(record.assistant)
    const messages: SharedSessionMessage[] = []

    if (userContent) {
      messages.push(normalizeMessage("user", userContent, true))
    }

    if (assistantContent) {
      messages.push(normalizeMessage("assistant", assistantContent, false))
    }

    return messages
  })
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function stripEmbeddedAnswerFromThinking(value: string): string {
  return value
    .replace(/^\s*\*\*\[Reasoning\]\*\*\s*/i, "")
    .split(/\n---+\s*\n+(?:\*\*)?\[Answer\](?:\*\*)?/i)[0]
    .split(/\n+(?:\*\*)?\[Answer\](?:\*\*)?/i)[0]
    .trim()
}

function stripAnswerLabel(value: string): string {
  return value
    .replace(/^\s*---+\s*\n+(?:\*\*)?\[Answer\](?:\*\*)?\s*\n*/i, "")
    .replace(/^\s*(?:\*\*)?\[Answer\](?:\*\*)?\s*\n*/i, "")
    .trim()
}

function formatSessionSnapshotToolCall(
  record: Record<string, unknown>,
): string {
  const name = readString(record.name) ?? "Tool call"
  const rawArguments = readString(record.arguments)
  let parsedArguments: unknown = rawArguments

  if (rawArguments) {
    try {
      parsedArguments = JSON.parse(rawArguments) as unknown
    } catch {
      parsedArguments = rawArguments
    }
  }

  return `**[ToolCall]**\n${JSON.stringify(
    {
      tool: name,
      arguments: parsedArguments,
    },
    null,
    2,
  )}`
}

function readSessionSnapshotMessageContent(
  role: string | null,
  content: unknown,
): string {
  if (!Array.isArray(content)) {
    const text = readString(content)
    return text ? stripAnswerLabel(text) : ""
  }

  const reasoningItems: string[] = []
  const visibleItems: string[] = []

  content.forEach((item) => {
    const record = readObject(item)

    if (!record) {
      return
    }

    const type = readString(record.type)
    const text = readString(record.text)
    const thinking = readString(record.thinking)

    if (type === "toolCall") {
      reasoningItems.push(formatSessionSnapshotToolCall(record))
      return
    }

    if (type === "thinking" && thinking) {
      const reasoning = stripEmbeddedAnswerFromThinking(thinking)

      if (reasoning) {
        reasoningItems.push(`**[Reasoning]**\n\n${reasoning}`)
      }

      return
    }

    if (text) {
      const visibleText = stripAnswerLabel(text)

      if (visibleText) {
        visibleItems.push(visibleText)
      }

      return
    }

    if (thinking) {
      const reasoning = stripEmbeddedAnswerFromThinking(thinking)

      if (reasoning) {
        reasoningItems.push(`**[Reasoning]**\n\n${reasoning}`)
      }
    }
  })

  const reasoningContent = reasoningItems.join("\n\n").trim()
  const visibleContent = visibleItems.join("\n\n").trim()

  if (role === "assistant" && reasoningContent && visibleContent) {
    return `${reasoningContent}\n\n**[Answer]**\n\n${visibleContent}`
  }

  return [reasoningContent, visibleContent].filter(Boolean).join("\n\n")
}

function appendSnapshotMessage(
  messages: SharedSessionMessage[],
  message: SharedSessionMessage,
): void {
  const previous = messages[messages.length - 1]

  if (previous?.role === "assistant" && message.role === "assistant") {
    previous.content = [previous.content, message.content]
      .map((entry) => entry.trim())
      .filter(Boolean)
      .join("\n\n")
    previous.model = previous.model ?? message.model
    return
  }

  messages.push(message)
}

function normalizeSessionSnapshotMessages(
  turns: unknown,
): SharedSessionMessage[] {
  if (!Array.isArray(turns)) {
    return []
  }

  const messages: SharedSessionMessage[] = []

  turns.forEach((turn) => {
    const turnRecord = readObject(turn)
    const rawMessages = turnRecord?.messages
    const model = readString(turnRecord?.model) ?? undefined

    if (!Array.isArray(rawMessages)) {
      return
    }

    rawMessages.forEach((message) => {
      const messageRecord = readObject(message)

      if (!messageRecord) {
        return
      }

      const rawRole = readString(messageRecord.role)
      const content = readSessionSnapshotMessageContent(
        rawRole,
        messageRecord.content,
      ).trim()

      if (!content) {
        return
      }

      if (rawRole === "user") {
        const normalized = normalizeMessage("user", content, true)
        messages.push(normalized)
        return
      }

      if (rawRole === "assistant") {
        appendSnapshotMessage(messages, {
          ...normalizeMessage("assistant", content, false),
          model,
        })
        return
      }

      if (rawRole === "toolResult") {
        const toolName = readString(messageRecord.toolName)
        const toolResultContent = toolName
          ? `Tool: ${toolName}\n\n${content}`
          : content

        appendSnapshotMessage(messages, {
          ...normalizeMessage(
            "assistant",
            `**[Reasoning]**\n\n**[ToolResult]**\n${toolResultContent}`,
            false,
          ),
          model,
        })
        return
      }
    })
  })

  return messages
}

function normalizeSessionSnapshotModelsUsed(turns: unknown): string[] {
  if (!Array.isArray(turns)) {
    return []
  }

  return Array.from(
    new Set(
      turns.flatMap((turn) => {
        const model = readString(readObject(turn)?.model)
        return model ? [model] : []
      }),
    ),
  )
}

function normalizeSharedSessionPayload(
  payload: Record<string, unknown>,
  options: {
    isPrivateLink: boolean
    sourceUri: string
    sharedBy: SharedSession["sharedBy"]
  },
): SharedSession {
  if (Array.isArray(payload.turns)) {
    return {
      sessionId: readString(payload.sessionId) ?? "shared-session",
      name: readString(payload.name) ?? "Shared session",
      isPrivateLink: options.isPrivateLink,
      createdAt: readString(payload.createdAt),
      sourceUri: options.sourceUri,
      modelsUsed: normalizeSessionSnapshotModelsUsed(payload.turns),
      sharedBy: options.sharedBy,
      messages: normalizeSessionSnapshotMessages(payload.turns),
    }
  }

  return {
    sessionId: readString(payload.session_id) ?? "shared-session",
    name: readString(payload.name) ?? "Shared session",
    isPrivateLink: options.isPrivateLink,
    createdAt: readString(payload.created_at),
    sourceUri: options.sourceUri,
    modelsUsed: normalizeModelsUsed(payload.models_used),
    sharedBy: options.sharedBy,
    messages: normalizeMessages(payload.contents),
  }
}

async function getRecord(uri: string): Promise<Record<string, unknown>> {
  const { repo, collection, rkey } = parseAtUri(uri)
  const service = await resolveAtprotoService(repo)
  const agent = new AtpAgent({
    service,
    fetch: noStoreFetch,
  })

  const response = await agent.com.atproto.repo.getRecord({
    repo,
    collection,
    rkey,
  })
  const body = response.data

  if (!body.value || typeof body.value !== "object") {
    throw new Error("Shared session record did not contain a JSON value.")
  }

  return body.value as Record<string, unknown>
}

async function getActorProfile(repo: string): Promise<{
  did: string
  handle: string | null
  displayName: string | null
  avatarUrl: string | null
}> {
  const agent = new AtpAgent({
    service: DEFAULT_ATPROTO_SERVICE,
    fetch: noStoreFetch,
  })

  try {
    const response = await agent.app.bsky.actor.getProfile({
      actor: repo,
    })
    const profile = response.data

    return {
      did: readString(profile.did) ?? repo,
      handle: readString(profile.handle),
      displayName: readString(profile.displayName),
      avatarUrl: readString(profile.avatar),
    }
  } catch {
    return {
      did: repo,
      handle: null,
      displayName: null,
      avatarUrl: null,
    }
  }
}

async function resolveAtprotoService(repo: string): Promise<string> {
  const configured = process.env.ATPROTO_PUBLIC_SERVICE_URL?.trim()

  if (configured) {
    return configured.replace(/\/$/, "")
  }

  if (!repo.startsWith("did:plc:")) {
    return DEFAULT_ATPROTO_SERVICE
  }

  const response = await noStoreFetch(
    `${PLC_DIRECTORY_URL}/${encodeURIComponent(repo)}`,
    {
      headers: {
        accept: "application/json",
      },
    },
  )

  if (!response.ok) {
    throw new Error(
      `Unable to resolve shared session DID (${response.status}).`,
    )
  }

  const didDocument = (await response.json()) as {
    service?: Array<{
      id?: unknown
      type?: unknown
      serviceEndpoint?: unknown
    }>
  }
  const pds = didDocument.service?.find(
    (service) =>
      service.id === "#atproto_pds" ||
      service.type === "AtprotoPersonalDataServer",
  )
  const endpoint = readString(pds?.serviceEndpoint)

  if (!endpoint) {
    throw new Error("Shared session DID did not advertise an ATproto PDS.")
  }

  return endpoint.replace(/\/$/, "")
}

export async function getAtprotoData(
  sharePath: string,
): Promise<Record<string, any>> {
  const sourceUri = resolveSharedSessionUri(sharePath)
  const { repo } = parseAtUri(sourceUri)
  const record = await getRecord(sourceUri)
  const sharedBy = await getActorProfile(repo)

  return {
    sourceUri,
    repo,
    record,
    sharedBy,
  }
}
export async function getSharedSession(
  sharePath: string,
  fragment: string | null,
): Promise<SharedSession> {
  const at_data = await getAtprotoData(sharePath)
  const record = at_data.record
  const isPrivateLink = isEncryptedSharedSessionRecord(record)
  if (isPrivateLink) {
    console.log("This is an encrypted session")
    if (fragment != null) {
      let fragments = fragment?.split(".")
      let nonce_bytes = sodium.from_base64(
        fragments[0],
        sodium.base64_variants.ORIGINAL,
      )
      let key_bytes = sodium.from_base64(
        fragments[1],
        sodium.base64_variants.ORIGINAL,
      )
      //@ts-ignore
      let ciphertxt = sodium.from_base64(
        record["enc_content"],
        sodium.base64_variants.ORIGINAL,
      )
      const additional_data = null
      const decrypted_data = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
        null,
        ciphertxt,
        additional_data,
        nonce_bytes,
        key_bytes,
      )
      const text = new TextDecoder().decode(decrypted_data)
      const obj = JSON.parse(text)
      return normalizeSharedSessionPayload(obj, {
        isPrivateLink,
        sourceUri: at_data.sourceUri,
        sharedBy: at_data.sharedBy,
      })
    }
  }

  return normalizeSharedSessionPayload(record, {
    isPrivateLink,
    sourceUri: at_data.sourceUri,
    sharedBy: at_data.sharedBy,
  })
}
