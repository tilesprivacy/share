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

// btoa/atob operate on byte strings, so UTF-8 encode around them. Used instead
// of Buffer so the client bundle doesn't need the Buffer polyfill.
function base64EncodeUtf8(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ""
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

function base64DecodeUtf8(value: string): string {
  const binary = atob(value)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

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

  const base64UrlToken = base64EncodeUtf8(uri)
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
  const tokenCandidates = token.startsWith("XQ6Ly9")
    ? [`Y${token}`, token]
    : [token]
  const decodedUri = tokenCandidates
    .map((candidate) => {
      // Strip anything outside the base64 alphabet (whitespace, stray
      // percent-decoded bytes) the way Buffer's forgiving decoder did.
      const strippedToken = candidate
        .replace(/-/g, "+")
        .replace(/_/g, "/")
        .replace(/[^A-Za-z0-9+/]/g, "")
      // A dangling char can't carry a full byte; forgiving decoders drop it.
      const normalizedToken =
        strippedToken.length % 4 === 1
          ? strippedToken.slice(0, -1)
          : strippedToken
      const paddedToken = normalizedToken.padEnd(
        normalizedToken.length + ((4 - (normalizedToken.length % 4)) % 4),
        "=",
      )
      try {
        return base64DecodeUtf8(paddedToken).trim()
      } catch {
        return ""
      }
    })
    .find((candidate) => candidate.startsWith("at://"))

  if (!decodedUri) {
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

interface AtprotoFetchOptions {
  signal?: AbortSignal
}

async function readXrpcErrorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const body = (await response.json()) as { message?: unknown }
    return readString(body.message) ?? fallback
  } catch {
    return fallback
  }
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

function hasCaldirSkillMention(value: unknown): boolean {
  return /\bcaldir\b/i.test(JSON.stringify(value) ?? "")
}

function attachReferencedSkillCall(
  message: SharedSessionMessage,
  hasCaldirMention: boolean,
): SharedSessionMessage {
  if (message.role !== "user" || message.skillCall || !hasCaldirMention) {
    return message
  }

  return {
    ...message,
    skillCall: {
      name: "caldir",
      params: message.content,
    },
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

interface SessionSnapshotMessageParts {
  reasoning: string
  visible: string
}

function readSessionSnapshotMessageParts(
  content: unknown,
): SessionSnapshotMessageParts {
  if (!Array.isArray(content)) {
    const text = readString(content)
    return {
      reasoning: "",
      visible: text ? stripAnswerLabel(text) : "",
    }
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

  return {
    reasoning: reasoningItems.join("\n\n").trim(),
    visible: visibleItems.join("\n\n").trim(),
  }
}

interface PendingAssistantMessage {
  reasoningParts: string[]
  answerParts: string[]
  model?: string
}

function buildAssistantSnapshotContent(
  pending: PendingAssistantMessage,
): string {
  let reasoning = pending.reasoningParts.join("\n\n").trim()
  const answer = pending.answerParts.join("\n\n").trim()

  if (reasoning && !/^\*\*\[Reasoning\]\*\*/.test(reasoning)) {
    reasoning = `**[Reasoning]**\n\n${reasoning}`
  }

  if (reasoning && answer) {
    return `${reasoning}\n\n**[Answer]**\n\n${answer}`
  }

  return reasoning || answer
}

function normalizeSessionSnapshotMessages(
  turns: unknown,
): SharedSessionMessage[] {
  if (!Array.isArray(turns)) {
    return []
  }

  const messages: SharedSessionMessage[] = []
  let pending: PendingAssistantMessage | null = null

  const flushPending = () => {
    if (!pending) {
      return
    }

    const content = buildAssistantSnapshotContent(pending)

    if (content) {
      messages.push({
        ...normalizeMessage("assistant", content, false),
        model: pending.model,
      })
    }

    pending = null
  }

  const ensurePending = (model: string | undefined) => {
    pending ??= { reasoningParts: [], answerParts: [] }
    pending.model = pending.model ?? model
    return pending
  }

  turns.forEach((turn) => {
    const turnRecord = readObject(turn)
    const rawMessages = turnRecord?.messages
    const model = readString(turnRecord?.model) ?? undefined
    const hasCaldirMention = hasCaldirSkillMention(turn)

    if (!Array.isArray(rawMessages)) {
      return
    }

    rawMessages.forEach((message) => {
      const messageRecord = readObject(message)

      if (!messageRecord) {
        return
      }

      const rawRole = readString(messageRecord.role)
      const parts = readSessionSnapshotMessageParts(messageRecord.content)

      if (rawRole === "user") {
        const content = [parts.reasoning, parts.visible]
          .filter(Boolean)
          .join("\n\n")
          .trim()

        if (!content) {
          return
        }

        flushPending()
        const normalized = attachReferencedSkillCall(
          normalizeMessage("user", content, true),
          hasCaldirMention,
        )
        messages.push(normalized)
        return
      }

      if (rawRole === "assistant") {
        if (!parts.reasoning && !parts.visible) {
          return
        }

        const target = ensurePending(model)

        if (parts.reasoning) {
          target.reasoningParts.push(parts.reasoning)
        }

        if (parts.visible) {
          target.answerParts.push(parts.visible)
        }

        return
      }

      if (rawRole === "toolResult") {
        const content = parts.visible || parts.reasoning

        if (!content) {
          return
        }

        const toolName = readString(messageRecord.toolName)
        const toolResultContent = toolName
          ? `Tool: ${toolName}\n\n${content}`
          : content

        ensurePending(model).reasoningParts.push(
          `**[ToolResult]**\n${toolResultContent}`,
        )
        return
      }
    })
  })

  flushPending()

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

// Plain XRPC GETs instead of @atproto/api: importing AtpAgent pulls every
// generated lexicon (~2.9MB of runtime JS) into the client bundle for what are
// two unauthenticated query endpoints.
async function getRecord(
  uri: string,
  options?: AtprotoFetchOptions,
): Promise<Record<string, unknown>> {
  const { repo, collection, rkey } = parseAtUri(uri)
  const service = await resolveAtprotoService(repo, options)
  const url = new URL("/xrpc/com.atproto.repo.getRecord", service)
  url.searchParams.set("repo", repo)
  url.searchParams.set("collection", collection)
  url.searchParams.set("rkey", rkey)

  // The record itself is always fetched fresh so deletions and edits on the
  // PDS are respected.
  const response = await fetch(url, {
    cache: "no-store",
    signal: options?.signal,
  })

  if (!response.ok) {
    throw new Error(
      await readXrpcErrorMessage(
        response,
        `Unable to load shared session record (${response.status}).`,
      ),
    )
  }

  const body = (await response
    .json()
    .catch(() => null)) as { value?: unknown } | null

  if (!body?.value || typeof body.value !== "object") {
    throw new Error("Shared session record did not contain a JSON value.")
  }

  return body.value as Record<string, unknown>
}

async function getActorProfile(
  repo: string,
  options?: AtprotoFetchOptions,
): Promise<SharedSession["sharedBy"]> {
  try {
    const url = new URL(
      "/xrpc/app.bsky.actor.getProfile",
      DEFAULT_ATPROTO_SERVICE,
    )
    url.searchParams.set("actor", repo)

    const response = await fetch(url, { signal: options?.signal })

    if (!response.ok) {
      throw new Error(`Unable to load profile (${response.status}).`)
    }

    const profile = (await response.json()) as Record<string, unknown>

    return {
      did: readString(profile.did) ?? repo,
      handle: readString(profile.handle),
      displayName: readString(profile.displayName),
      avatarUrl: readString(profile.avatar),
    }
  } catch {
    // The profile is decoration; never let its failure (including a timeout
    // on the shared signal) discard a successfully fetched record.
    return {
      did: repo,
      handle: null,
      displayName: null,
      avatarUrl: null,
    }
  }
}

async function resolveAtprotoService(
  repo: string,
  options?: AtprotoFetchOptions,
): Promise<string> {
  const configured = process.env.ATPROTO_PUBLIC_SERVICE_URL?.trim()

  if (configured) {
    return configured.replace(/\/$/, "")
  }

  if (!repo.startsWith("did:plc:")) {
    return DEFAULT_ATPROTO_SERVICE
  }

  const response = await fetch(
    `${PLC_DIRECTORY_URL}/${encodeURIComponent(repo)}`,
    {
      headers: {
        accept: "application/json",
      },
      signal: options?.signal,
    },
  )

  if (!response.ok) {
    throw new Error(
      `Unable to resolve shared session DID (${response.status}).`,
    )
  }

  const didDocument = (await response.json().catch(() => ({}))) as {
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

export interface AtprotoShareData {
  sourceUri: string
  repo: string
  record: Record<string, unknown>
  sharedBy: SharedSession["sharedBy"]
}

export async function getAtprotoData(
  sharePath: string,
  options?: AtprotoFetchOptions,
): Promise<AtprotoShareData> {
  const sourceUri = resolveSharedSessionUri(sharePath)
  const { repo } = parseAtUri(sourceUri)
  // The profile lookup is independent of PDS resolution + record retrieval, so
  // run both branches concurrently instead of as a 3-hop waterfall.
  const [record, sharedBy] = await Promise.all([
    getRecord(sourceUri, options),
    getActorProfile(repo, options),
  ])

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
  // Private links carry the key material in the URL fragment. Warm up the
  // (lazy-loaded) sodium module while the record downloads; public links never
  // pay for it.
  const sodiumPromise = fragment ? import("libsodium-wrappers") : null
  // If the record turns out not to be encrypted (or its fetch fails), the
  // warm-up is never awaited — keep its rejection from surfacing as an
  // unhandled one.
  sodiumPromise?.catch(() => {})
  const at_data = await getAtprotoData(sharePath)
  const record = at_data.record
  const isPrivateLink = isEncryptedSharedSessionRecord(record)
  if (isPrivateLink && !fragment) {
    throw new Error(
      "This is a private link, but its decryption key is missing from the URL. Ask for the full link, including the part after #.",
    )
  }
  if (isPrivateLink && fragment) {
    const sodium = (await sodiumPromise!).default
    await sodium.ready
    const fragments = fragment.split(".")
    const nonce_bytes = sodium.from_base64(
      fragments[0],
      sodium.base64_variants.ORIGINAL,
    )
    const key_bytes = sodium.from_base64(
      fragments[1],
      sodium.base64_variants.ORIGINAL,
    )
    const ciphertxt = sodium.from_base64(
      record.enc_content as string,
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

  return normalizeSharedSessionPayload(record, {
    isPrivateLink,
    sourceUri: at_data.sourceUri,
    sharedBy: at_data.sharedBy,
  })
}
