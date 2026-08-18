"use client"

import {
  AlertCircle,
  Brain,
  CalendarDays,
  Check,
  ChevronDown,
  Copy,
  Download,
  FileText,
  Terminal,
  Wrench,
} from "lucide-react"
import Image from "next/image"
import type { createMathPlugin } from "@streamdown/math"
import {
  createContext,
  memo,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"
import { Streamdown } from "streamdown"
import "katex/dist/katex.min.css"
import { SharePageQrCode } from "@/components/share-page-qr-code"
import { normalizeShareMathMarkdown } from "@/lib/normalize-share-math-markdown"
import {
  getSharedSession,
  type SharedSession,
  type SharedSessionMessage,
} from "@/lib/shared-session"
import { TILES_APP_ORIGIN } from "@/lib/site-url"
import { cn } from "@/lib/utils"

type ShareMathPlugin = ReturnType<typeof createMathPlugin>

// @streamdown/math eagerly imports all of KaTeX (~600KB), so it is only
// loaded once a session that actually contains math arrives. The promise is
// module-level so the plugin keeps a stable identity — Streamdown's memo
// compares the plugins prop by reference and re-parses everything when it
// changes.
let mathPluginPromise: Promise<ShareMathPlugin | null> | null = null

function loadShareMathPlugin(): Promise<ShareMathPlugin | null> {
  mathPluginPromise ??= import("@streamdown/math")
    .then((mod) =>
      mod.createMathPlugin({
        singleDollarTextMath: true,
      }),
    )
    .catch(() => {
      // Chunk failed to load (deploy rotated hashes, flaky network): math
      // renders as raw TeX this time, and the next session retries the import.
      mathPluginPromise = null
      return null
    })
  return mathPluginPromise
}

// Matches $..$, \(..\), \[..\] before normalizeShareMathMarkdown rewrites the
// latter two into dollar form.
const MATH_HINT_PATTERN = /\$|\\\(|\\\[/

function sessionHasMath(sharedSession: SharedSession): boolean {
  return sharedSession.messages.some((message) =>
    MATH_HINT_PATTERN.test(message.content),
  )
}

const MathPluginContext = createContext<ShareMathPlugin | null>(null)

interface ShareSessionClientProps {
  mockApiUrl?: string
  initialSharedSession?: SharedSession | null
  shareToken?: string
  initialErrorMessage?: string | null
}

type ShareThemePreference = "light" | "dark" | "system"

function readStoredShareTheme(): ShareThemePreference {
  if (typeof window === "undefined") {
    return "system"
  }

  try {
    const storedTheme = window.localStorage.getItem("share-page-theme")

    return storedTheme === "light" ||
      storedTheme === "dark" ||
      storedTheme === "system"
      ? storedTheme
      : "system"
  } catch {
    return "system"
  }
}

function writeStoredShareTheme(themePreference: ShareThemePreference): void {
  if (typeof window === "undefined") {
    return
  }

  try {
    window.localStorage.setItem("share-page-theme", themePreference)
  } catch {
    // Theme still works for the current page when browser storage is unavailable.
  }
}

async function getSharedSessionFromMockApi(
  mockApiUrl: string,
): Promise<SharedSession> {
  const response = await fetch(mockApiUrl, {
    cache: "no-store",
  })

  if (!response.ok) {
    throw new Error(`Unable to load mock shared session (${response.status}).`)
  }

  const payload = (await response.json()) as SharedSession
  return payload
}

function getSharedByLabel(sharedSession: SharedSession): string {
  const preferredName =
    sharedSession.sharedBy.displayName ?? sharedSession.sharedBy.handle
  return preferredName && preferredName.trim().length > 0
    ? preferredName
    : sharedSession.sharedBy.did
}

function shortenShareLinkLabel(rawUrl: string): string {
  if (!rawUrl) {
    return "Loading link..."
  }

  try {
    const parsed = new URL(rawUrl)
    const displayHost = parsed.host.replace(/^www\./, "")
    const rawToken = parsed.pathname.startsWith("/share/")
      ? parsed.pathname.slice("/share/".length)
      : parsed.pathname.replace(/^\/+/, "")
    const simplifiedPath = rawToken
      ? (() => {
          const token = rawToken
          if (token.length <= 14) {
            return `/${token}`
          }
          return `/${token.slice(0, 6)}...${token.slice(-6)}`
        })()
      : parsed.pathname.length > 20
        ? `${parsed.pathname.slice(0, 20)}...${parsed.pathname.slice(-6)}`
        : parsed.pathname
    return `${displayHost}${simplifiedPath}`
  } catch {
    return rawUrl.length > 42
      ? `${rawUrl.slice(0, 26)}...${rawUrl.slice(-8)}`
      : rawUrl
  }
}

function buildAtprotoAtUriUrl(sourceUri: string): string | null {
  if (!sourceUri.startsWith("at://")) {
    return null
  }

  return `https://atproto.at/uri/${encodeURIComponent(sourceUri)}`
}

function isTilesSessionSnapshotRecord(sourceUri: string): boolean {
  const collection = sourceUri.match(/^at:\/\/[^/]+\/([^/]+)\//)?.[1]

  return collection === "run.tiles.chat.sessionSnapshot"
}

function buildBlueskyProfileUrl(handle: string | null, did: string): string {
  const normalizedHandle = handle?.trim().replace(/^@+/, "")
  const profileId =
    normalizedHandle && normalizedHandle.length > 0 ? normalizedHandle : did
  return `https://bsky.app/profile/${encodeURIComponent(profileId)}`
}

function buildHuggingFaceModelUrl(modelId: string): string {
  // Drop the ollama-style quantization tag (e.g. ":Q4_K_M") — it is not part
  // of the Hugging Face repo id.
  const repoId = modelId.split(":")[0]

  return `https://huggingface.co/${repoId
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`
}

function isSafeMarkdownUrl(url: string): boolean {
  const trimmedUrl = url.trim()

  if (trimmedUrl.startsWith("/") || trimmedUrl.startsWith("#")) {
    return true
  }

  try {
    const parsed = new URL(trimmedUrl)
    return parsed.protocol === "http:" || parsed.protocol === "https:"
  } catch {
    return false
  }
}

function transformShareMarkdownUrl(url: string): string | null {
  return isSafeMarkdownUrl(url) ? url : null
}

function sanitizeTranscriptFilenamePart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
}

function buildMarkdownTranscript(
  sharedSession: SharedSession,
  sharedByLabel: string,
  pageUrl: string,
): string {
  const lines = [
    `# ${sharedSession.name || "Shared Tiles conversation"}`,
    "",
    `- Shared by: ${sharedByLabel}`,
    `- Created: ${sharedSession.createdAt}`,
    `- Source: ${sharedSession.sourceUri}`,
    ...(pageUrl ? [`- Share link: ${pageUrl}`] : []),
    ...(sharedSession.modelsUsed.length > 0
      ? [`- Models: ${sharedSession.modelsUsed.join(", ")}`]
      : []),
    "",
    "---",
    "",
  ]

  sharedSession.messages.forEach((message, index) => {
    const roleLabel = message.role === "assistant" ? "Assistant" : "User"
    const modelLine =
      message.role === "assistant" && message.model
        ? [`_Model: ${message.model}_`, ""]
        : []

    lines.push(
      `## ${index + 1}. ${roleLabel}`,
      "",
      ...modelLine,
      message.content.trim(),
      "",
    )
  })

  return `${lines.join("\n").trim()}\n`
}

function downloadMarkdownTranscript(
  sharedSession: SharedSession,
  sharedByLabel: string,
  pageUrl: string,
): void {
  const transcript = buildMarkdownTranscript(
    sharedSession,
    sharedByLabel,
    pageUrl,
  )
  const filenameBase =
    sanitizeTranscriptFilenamePart(sharedSession.name) ||
    sanitizeTranscriptFilenamePart(sharedSession.sessionId) ||
    "tiles-shared-chat"
  const blob = new Blob([transcript], {
    type: "text/markdown;charset=utf-8",
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")

  anchor.href = url
  anchor.download = `${filenameBase}.md`
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

interface MarkdownFrontmatter {
  entries: Array<{ key: string; value: string }>
  body: string
}

function splitMarkdownFrontmatter(content: string): MarkdownFrontmatter {
  const match = content.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)

  if (!match) {
    return { entries: [], body: content }
  }

  const entries = match[1]
    .split("\n")
    .map((line) => line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/))
    .filter((entry): entry is RegExpMatchArray => entry !== null)
    .map(([, key, value]) => ({ key, value }))

  return { entries, body: content.slice(match[0].length) }
}

function MarkdownFrontmatterBlock({
  entries,
}: {
  entries: Array<{ key: string; value: string }>
}) {
  if (entries.length === 0) {
    return null
  }

  return (
    <dl className="share-markdown-frontmatter">
      {entries.map(({ key, value }) => (
        <div
          key={key}
          className="grid gap-1 border-b border-black/8 py-2 first:pt-0 last:border-b-0 last:pb-0 sm:grid-cols-[6.5rem_minmax(0,1fr)] sm:gap-3"
        >
          <dt className="font-mono text-[0.72rem] uppercase tracking-[0.08em] text-black/42 dark:text-white/42">
            {key}
          </dt>
          <dd className="min-w-0 break-words text-[0.86rem] leading-5 text-black/72 dark:text-white/72">
            {value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function ShareMarkdownLink({
  href,
  children,
  className,
  node: _node,
  ...props
}: React.ComponentProps<"a"> & { node?: unknown }) {
  const safeHref =
    typeof href === "string" && isSafeMarkdownUrl(href) ? href : undefined
  const isLocal = safeHref?.startsWith("/") || safeHref?.startsWith("#")

  return (
    <a
      {...props}
      href={safeHref}
      target={isLocal ? undefined : "_blank"}
      rel={isLocal ? undefined : "noopener noreferrer"}
      className={cn(
        "font-medium text-black underline decoration-black/25 underline-offset-4 transition-colors hover:text-black/80 hover:decoration-black/45 dark:text-white dark:decoration-white/25 dark:hover:text-white/80 dark:hover:decoration-white/45",
        className,
      )}
    >
      {children}
    </a>
  )
}

// Module-level so every Streamdown instance sees stable prop identities;
// Streamdown mode="static" re-parses the full message when memoized props
// change, so unstable references here would re-parse the whole transcript on
// unrelated state changes.
const shareMarkdownComponents = { a: ShareMarkdownLink }
const shareMarkdownControls = { table: true, code: false, mermaid: false }

function MarkdownMessage({ content }: { content: string }) {
  const mathPlugin = useContext(MathPluginContext)
  const { entries, body } = useMemo(
    () => splitMarkdownFrontmatter(content.replace(/\r\n?/g, "\n")),
    [content],
  )
  const normalizedContent = useMemo(() => normalizeShareMathMarkdown(body), [body])
  const plugins = useMemo(
    () => (mathPlugin ? { math: mathPlugin } : undefined),
    [mathPlugin],
  )

  return (
    <div className="grid gap-3">
      <MarkdownFrontmatterBlock entries={entries} />
      <Streamdown
        mode="static"
        className="share-markdown break-words"
        urlTransform={transformShareMarkdownUrl}
        plugins={plugins}
        controls={shareMarkdownControls}
        lineNumbers={false}
        components={shareMarkdownComponents}
      >
        {normalizedContent}
      </Streamdown>
    </div>
  )
}

function formatSkillCallName(name: string): string {
  return name
    .split(/[-_\s]+/g)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ")
}

function CaldirIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M19 21C19.5304 21 20.0391 20.7893 20.4142 20.4142C20.7893 20.0391 21 19.5304 21 19V7C21 6.46957 20.7893 5.96086 20.4142 5.58579C20.0391 5.21071 19.5303 5 19 5H13.1C12.7655 5.00328 12.4355 4.92261 12.1403 4.76538C11.8451 4.60815 11.594 4.37938 11.41 4.1L10.6 2.9C10.4179 2.62347 10.17 2.39648 9.8785 2.2394C9.58702 2.08231 9.26111 2.00005 8.93 2H5C4.46957 2 3.96086 2.21071 3.58579 2.58579C3.21071 2.96086 3 3.46957 3 4V19C3 19.5304 3.21071 20.0391 3.58579 20.4142C3.96086 20.7893 4.46957 21 5 21H19Z" />
      <path d="M3 9H21" />
      <path d="M8 13H8.01" />
      <path d="M12 13H12.01" />
      <path d="M16 13H16.01" />
      <path d="M8 17H8.01" />
      <path d="M12 17H12.01" />
    </svg>
  )
}

function DirectSkillCallMessage({
  message,
}: {
  message: SharedSessionMessage
}) {
  if (!message.skillCall) {
    return null
  }

  const params = message.skillCall.params || message.content

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5 text-[0.95rem] leading-7">
      <span className="inline-flex min-w-0 items-center gap-2 font-medium text-[#2f80df] dark:text-[#72a8ff]">
        <CaldirIcon className="h-4 w-4 shrink-0" />
        <span className="truncate">
          {formatSkillCallName(message.skillCall.name)}
        </span>
      </span>
      {params ? (
        <span className="min-w-0 break-words text-[#2b2c31] dark:text-[#EDEDEF]">
          {params}
        </span>
      ) : null}
    </div>
  )
}

function splitReasoningContent(content: string): {
  reasoning: string | null
  answer: string
} {
  const normalizedContent = content.replace(/\r\n?/g, "\n").trim()
  const reasoningMatch = normalizedContent.match(/^\*\*\[Reasoning\]\*\*\s*\n+/)

  if (!reasoningMatch) {
    return {
      reasoning: null,
      answer: content,
    }
  }

  const contentAfterLabel = normalizedContent.slice(reasoningMatch[0].length)
  const answerDividerMatch = contentAfterLabel.match(
    /\n---+\s*\n+(?:\*\*)?\[Answer\](?:\*\*)?\s*\n*/,
  )
  const answerLabelMatch = contentAfterLabel.match(
    /\n+(?:\*\*)?\[Answer\](?:\*\*)?\s*\n*/,
  )
  const splitMatch = answerDividerMatch ?? answerLabelMatch

  if (!splitMatch || splitMatch.index === undefined) {
    return {
      reasoning: contentAfterLabel,
      answer: "",
    }
  }

  return {
    reasoning: contentAfterLabel.slice(0, splitMatch.index).trim(),
    answer: contentAfterLabel
      .slice(splitMatch.index + splitMatch[0].length)
      .trim(),
  }
}

type ReasoningSegment =
  | {
      type: "reasoning"
      content: string
    }
  | {
      type: "tool-call" | "tool-result"
      content: string
    }

const reasoningMarkerPattern =
  /\*\*\[(Reasoning|ToolCall|ToolResult|ToolOutput)\]\*\*/g

function parseReasoningSegments(content: string): ReasoningSegment[] {
  const normalizedContent = content.replace(/\r\n?/g, "\n").trim()
  const segments: ReasoningSegment[] = []
  let activeType: ReasoningSegment["type"] = "reasoning"
  let lastIndex = 0

  for (const match of normalizedContent.matchAll(reasoningMarkerPattern)) {
    const markerIndex = match.index ?? 0
    const segmentContent = normalizedContent.slice(lastIndex, markerIndex).trim()

    if (segmentContent) {
      segments.push({
        type: activeType,
        content: segmentContent,
      })
    }

    activeType =
      match[1] === "ToolCall"
        ? "tool-call"
        : match[1] === "ToolResult" || match[1] === "ToolOutput"
          ? "tool-result"
          : "reasoning"
    lastIndex = markerIndex + match[0].length
  }

  const trailingContent = normalizedContent.slice(lastIndex).trim()

  if (trailingContent) {
    segments.push({
      type: activeType,
      content: trailingContent,
    })
  }

  return segments
}

function parseToolPayload(content: string): Record<string, unknown> | null {
  const trimmedContent = content.trim()

  try {
    const parsed = JSON.parse(trimmedContent) as unknown
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    // Continue below for the newer text metadata shape:
    // Tool: bash
    // Arguments: {"command":["bash","-lc","ls"]}
  }

  const toolMatch = trimmedContent.match(/^Tool:\s*(.+?)\s*$/im)
  const argumentsMatch = trimmedContent.match(/^Arguments:\s*([\s\S]*)$/im)
  const toolName = toolMatch?.[1]?.trim()

  if (!toolName) {
    return null
  }

  const payload: Record<string, unknown> = {
    tool: toolName,
  }

  if (argumentsMatch?.[1]) {
    const rawArguments = argumentsMatch[1].trim()

    try {
      payload.arguments = JSON.parse(rawArguments) as unknown
    } catch {
      payload.arguments = rawArguments
    }
  }

  return payload
}

function formatToolValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry)).join(" ")
  }

  if (value === null || value === undefined) {
    return ""
  }

  if (typeof value === "object") {
    return JSON.stringify(value)
  }

  return String(value)
}

function formatToolRows(payload: Record<string, unknown> | null): string {
  if (!payload) {
    return ""
  }

  return JSON.stringify(payload, null, 2)
}

function getToolName(payload: Record<string, unknown>): string {
  return (
    formatToolValue(payload.tool) ||
    formatToolValue(payload.name) ||
    formatToolValue(payload.function)
  )
}

function getToolArguments(payload: Record<string, unknown>): Record<
  string,
  unknown
> {
  const candidate =
    payload.arguments ?? payload.args ?? payload.input ?? payload.parameters

  return candidate && typeof candidate === "object" && !Array.isArray(candidate)
    ? (candidate as Record<string, unknown>)
    : payload
}

function formatFileReadDetail(args: Record<string, unknown>): string {
  const path = formatToolValue(args.path)
  const lineStart = formatToolValue(args.line_start)
  const lineEnd = formatToolValue(args.line_end)
  const lineRange =
    lineStart && lineEnd
      ? `:${lineStart}-${lineEnd}`
      : lineStart
        ? `:${lineStart}`
        : ""

  return path ? `${path}${lineRange}` : "View file request"
}

function formatShellCommandDetail(command: unknown): string {
  if (Array.isArray(command)) {
    const parts = command.map((entry) => String(entry))
    const shell = parts[0]?.toLowerCase()

    if (
      (shell === "bash" || shell === "sh" || shell === "zsh") &&
      parts[1] === "-lc" &&
      parts[2]
    ) {
      return parts.slice(2).join(" ")
    }

    return parts.join(" ")
  }

  return formatToolValue(command)
}

function getToolCallSummary(payload: Record<string, unknown> | null): {
  label: string
  detail: string
  icon: "terminal" | "file" | "tool"
} {
  if (!payload) {
    return {
      label: "Tool call",
      detail: "View raw invocation",
      icon: "tool",
    }
  }

  const toolName = getToolName(payload)
  const normalizedToolName = toolName.trim().toLowerCase()
  const args = getToolArguments(payload)
  const command = args.command ?? payload.command

  if (
    normalizedToolName === "bash" ||
    normalizedToolName === "shell" ||
    Array.isArray(command)
  ) {
    return {
      label: toolName || "Shell command",
      detail: formatShellCommandDetail(command),
      icon: "terminal",
    }
  }

  if (
    normalizedToolName === "read" ||
    normalizedToolName === "open" ||
    typeof args.path === "string" ||
    typeof payload.path === "string"
  ) {
    return {
      label: toolName || "Read file",
      detail: formatFileReadDetail(args),
      icon: "file",
    }
  }

  return {
    label: toolName || "Tool call",
    detail: "View parameters",
    icon: "tool",
  }
}

function ToolIcon({ icon }: { icon: "terminal" | "file" | "tool" }) {
  const className = "h-3.5 w-3.5"

  if (icon === "terminal") {
    return <Terminal className={className} aria-hidden />
  }

  if (icon === "file") {
    return <FileText className={className} aria-hidden />
  }

  return <Wrench className={className} aria-hidden />
}

function ToolCallCard({ content }: { content: string }) {
  const payload = parseToolPayload(content)
  const summary = getToolCallSummary(payload)
  const rawPayload = formatToolRows(payload) || content.trim()
  const shouldShowRawPayload =
    rawPayload.length > 0 && rawPayload.trim() !== summary.detail.trim()

  return (
    <div className="min-w-0 py-1 text-black/68 dark:text-white/68">
      <div className="flex min-w-0 items-start gap-2.5">
        <span className="mt-1 inline-flex h-5 w-5 shrink-0 items-center justify-center text-black/48 dark:text-white/48">
          <ToolIcon icon={summary.icon} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-[0.82rem] font-medium leading-6 text-black/70 dark:text-white/72">
              {summary.label}
            </span>
            <span className="font-mono text-[0.76rem] leading-6 text-black/52 dark:text-white/52">
              {summary.detail}
            </span>
          </div>
          {shouldShowRawPayload ? (
            <div className="mt-1.5">
              <div className="text-[0.72rem] font-medium leading-5 text-black/42 dark:text-white/42">
                Invocation details
              </div>
              <ToolInvocationDetails payload={payload} rawPayload={rawPayload} />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function ToolInvocationDetails({
  payload,
  rawPayload,
}: {
  payload: Record<string, unknown> | null
  rawPayload: string
}) {
  const args = payload ? getToolArguments(payload) : null
  const entries = args
    ? Object.entries(args).filter(([key]) => key !== "tool")
    : []

  if (entries.length === 0) {
    return (
      <pre className="mt-1.5 max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-black/[0.035] p-2.5 font-mono text-[0.72rem] leading-5 text-black/58 dark:bg-white/[0.055] dark:text-white/58">
        {rawPayload}
      </pre>
    )
  }

  return (
    <div className="mt-1.5 grid max-w-full gap-2 rounded-md bg-black/[0.035] p-2.5 text-[0.76rem] leading-5 text-black/62 dark:bg-white/[0.055] dark:text-white/62">
      {entries.map(([key, value]) => (
        <div
          key={key}
          className="grid min-w-0 gap-1 sm:grid-cols-[5.5rem_minmax(0,1fr)] sm:gap-3"
        >
          <div className="font-mono text-black/42 dark:text-white/42">
            {key}
          </div>
          <pre className="min-w-0 whitespace-pre-wrap break-words font-mono text-black/68 dark:text-white/68">
            {formatToolValue(value)}
          </pre>
        </div>
      ))}
    </div>
  )
}

function parseToolResultContent(content: string): {
  toolName: string | null
  output: string
} {
  const normalizedContent = content.replace(/\r\n?/g, "\n").trim()
  const toolMatch = normalizedContent.match(/^Tool:\s*(.+?)\s*(?:\n|$)/)

  if (!toolMatch) {
    return {
      toolName: null,
      output: normalizedContent,
    }
  }

  return {
    toolName: toolMatch[1].trim(),
    output: normalizedContent.slice(toolMatch[0].length).trim(),
  }
}

interface CaldirEvent {
  date: string
  time: string
  title: string
  calendar: string | null
}

function parseCaldirEvents(output: string): CaldirEvent[] | null {
  const lines = output
    .replace(/\x1b\[[0-9;]*m/g, "")
    .split("\n")
    .map((line) => line.trimEnd())
  const datePattern = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+[A-Z][a-z]{2}\s+\d{1,2}$/
  const eventPattern = /^\s+(all-day|\d{1,2}:\d{2})\s+(.+?)(?:\s+\[([^\]]+)\])?\s*$/
  const events: CaldirEvent[] = []
  let currentDate: string | null = null

  for (const line of lines) {
    const dateMatch = line.trim().match(datePattern)

    if (dateMatch) {
      currentDate = dateMatch[0]
      continue
    }

    const eventMatch = line.match(eventPattern)

    if (currentDate && eventMatch) {
      events.push({
        date: currentDate,
        time: eventMatch[1],
        title: eventMatch[2].trim(),
        calendar: eventMatch[3]?.trim() ?? null,
      })
    }
  }

  return events.length > 0 ? events : null
}

function CaldirEventsSheet({ events }: { events: CaldirEvent[] }) {
  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-2 text-[0.82rem] font-medium text-black/65 dark:text-white/70">
        <CalendarDays className="h-4 w-4 text-black/48 dark:text-white/48" aria-hidden />
        <span>Caldir events</span>
      </div>
      <div className="grid gap-2">
        {events.map((event, index) => (
          <div
            key={`${event.date}-${event.time}-${event.title}-${index}`}
            className="grid min-w-0 gap-1 rounded-md border border-black/8 bg-white/55 px-3 py-2 dark:border-white/10 dark:bg-white/[0.035] sm:grid-cols-[7.5rem_minmax(0,1fr)] sm:items-start sm:gap-3"
          >
            <div className="text-[0.76rem] leading-5 text-black/48 dark:text-white/48">
              <div>{event.date}</div>
              <div className="font-mono">{event.time}</div>
            </div>
            <div className="min-w-0">
              <div className="break-words text-[0.84rem] leading-5 text-black/75 dark:text-white/75">
                {event.title}
              </div>
              {event.calendar ? (
                <div className="mt-0.5 break-all text-[0.72rem] leading-5 text-black/42 dark:text-white/42">
                  {event.calendar}
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ToolResultCard({ content }: { content: string }) {
  const { toolName, output } = parseToolResultContent(content)
  const caldirEvents =
    toolName?.toLowerCase() === "bash" || toolName?.toLowerCase() === "shell"
      ? parseCaldirEvents(output)
      : null
  const normalizedToolName = toolName?.toLowerCase()
  const isLongOutput = output.length > 1800 || output.split("\n").length > 24
  const icon =
    normalizedToolName === "bash" || normalizedToolName === "shell"
      ? "terminal"
      : "tool"

  return (
    <div className="min-w-0 py-1 text-black/68 dark:text-white/68">
      <div className="mb-1 flex min-w-0 items-center gap-2 text-[0.82rem] leading-6 text-black/58 dark:text-white/62">
        <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center text-black/48 dark:text-white/48">
          <ToolIcon icon={icon} />
        </span>
        <span className="font-medium">Tool result</span>
        {toolName ? (
          <span className="font-mono text-[0.76rem] text-black/48 dark:text-white/48">
            {toolName}
          </span>
        ) : null}
        <Check className="h-3.5 w-3.5 shrink-0 text-black/40 dark:text-white/42" aria-hidden />
      </div>
      {output ? (
        <div className="pl-7">
          <div
            data-tool-result-scroll-block={isLongOutput ? "" : undefined}
            className={cn(
              "min-w-0 rounded-md border border-black/10 bg-black/[0.025] p-3 dark:border-white/10 dark:bg-black/20",
              isLongOutput
                ? "max-h-72 overflow-auto overscroll-contain [scrollbar-gutter:stable] print:max-h-none print:overflow-visible"
                : "",
            )}
          >
            {caldirEvents ? (
              <CaldirEventsSheet events={caldirEvents} />
            ) : (
              <MarkdownMessage content={output} />
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function ReasoningSegmentList({ content }: { content: string }) {
  const segments = useMemo(() => parseReasoningSegments(content), [content])

  return (
    <div className="grid gap-4">
      {segments.map((segment, index) => {
        if (segment.type === "tool-call") {
          return <ToolCallCard key={index} content={segment.content} />
        }

        if (segment.type === "tool-result") {
          return <ToolResultCard key={index} content={segment.content} />
        }

        return <MarkdownMessage key={index} content={segment.content} />
      })}
    </div>
  )
}

function ReasoningDisclosure({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="group flex w-full items-center gap-2 text-left text-[0.95rem] font-medium leading-6 text-black/60 transition-colors hover:text-black/80 dark:text-white/60 dark:hover:text-white/80"
        aria-expanded={expanded}
      >
        <Brain className="h-4 w-4 shrink-0" aria-hidden />
        <span>Reasoning details</span>
        <ChevronDown
          className={`h-4 w-4 transition-transform group-hover:text-black/70 dark:group-hover:text-white/60 ${expanded ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>
      {expanded ? (
        <div className="mt-4 border-l-2 border-black/20 pl-5 text-[0.95rem] leading-7 text-black/75 dark:border-white/24 dark:text-white/70">
          <ReasoningSegmentList content={content} />
        </div>
      ) : null}
    </div>
  )
}

function ChatMessageContent({ message }: { message: SharedSessionMessage }) {
  if (message.role === "user" && message.skillCall) {
    return <DirectSkillCallMessage message={message} />
  }

  const { reasoning, answer } =
    message.role === "assistant"
      ? splitReasoningContent(message.content)
      : { reasoning: null, answer: message.content }

  return (
    <div className="space-y-6">
      {reasoning ? <ReasoningDisclosure content={reasoning} /> : null}
      {answer ? <MarkdownMessage content={answer} /> : null}
    </div>
  )
}

function MessageMetaRow({
  message,
  modelLabel,
}: {
  message: SharedSessionMessage
  modelLabel: string | null
}) {
  const [copied, setCopied] = useState(false)

  if (message.role !== "assistant") {
    return null
  }

  return (
    <div className="mt-3 flex items-center gap-2 text-[0.78rem] text-black/60 dark:text-white/65">
      <button
        type="button"
        onClick={() => {
          const answerToCopy = splitReasoningContent(message.content).answer.trim()
          const copyPayload =
            answerToCopy.length > 0 ? answerToCopy : message.content
          void navigator.clipboard.writeText(copyPayload).then(() => {
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1200)
          })
        }}
        className="inline-flex h-5 w-5 items-center justify-center rounded-sm text-black/60 transition-colors hover:text-black/80 dark:text-white/65 dark:hover:text-white/80"
        aria-label="Copy response"
        title="Copy response"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5" aria-hidden />
        ) : (
          <Copy className="h-3.5 w-3.5" aria-hidden />
        )}
      </button>
      {modelLabel ? (
        <span className="truncate">
          Generated with{" "}
          <a
            href={buildHuggingFaceModelUrl(modelLabel)}
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-black/20 underline-offset-2 transition-colors hover:text-black/70 hover:decoration-black/35 dark:decoration-white/20 dark:hover:text-white/70 dark:hover:decoration-white/35"
          >
            {modelLabel}
          </a>
        </span>
      ) : null}
    </div>
  )
}

// Memoized so parent state changes (theme, copied-link flashes, page URL
// arriving) don't re-render — and therefore re-parse — the whole transcript.
const MessageBubble = memo(function MessageBubble({
  message,
  modelLabel,
}: {
  message: SharedSessionMessage
  modelLabel: string | null
}) {
  const isAssistant = message.role === "assistant"

  return (
    <div
      className={`flex w-full min-w-0 print:px-2 ${isAssistant ? "justify-start" : "justify-end"}`}
    >
      <div
        className={`min-w-0 max-w-[calc(100vw-2rem)] break-inside-avoid rounded-2xl px-4 py-3 text-sm leading-7 print:max-w-[94%] print:break-inside-auto sm:max-w-[78%] sm:px-5 sm:text-[0.95rem] ${
          isAssistant
            ? "bg-transparent text-[#2e2f33] print:bg-transparent dark:text-[#E6E6E8]"
            : "bg-black/[0.045] text-[#2b2c31] print:bg-black/[0.045] dark:bg-white/[0.085] dark:text-[#EDEDEF] dark:print:bg-white/[0.085]"
        }`}
      >
        <ChatMessageContent message={message} />
        <MessageMetaRow message={message} modelLabel={modelLabel} />
      </div>
    </div>
  )
})

function EmptyState() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center rounded-sm border border-dashed border-black/12 px-6 text-center dark:border-white/12">
      <p className="max-w-sm text-sm leading-6 text-[#6b6b6f] dark:text-[#A8A8A8]">
        This shared session was found, but it does not contain displayable user
        or assistant messages yet.
      </p>
    </div>
  )
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="mx-auto flex h-full w-full max-w-xl flex-col items-center justify-center px-6 text-center">
      <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-sm border border-black/10 bg-black/5 text-black/60 dark:border-white/10 dark:bg-[#101010] dark:text-white/65">
        <AlertCircle className="h-4 w-4" aria-hidden />
      </div>
      <h1 className="text-3xl font-semibold leading-tight tracking-tight text-[#1d1d1f] dark:text-[#EDEDEF] sm:text-4xl">
        Shared session unavailable
      </h1>
      <p className="mt-3 max-w-md text-sm leading-6 text-[#6b6b6f] dark:text-[#A8A8A8]">
        {message}
      </p>
    </div>
  )
}

function ShareFloatingDownloadBar({
  themePreference,
  onSetThemePreference,
}: {
  themePreference: ShareThemePreference
  onSetThemePreference: (nextTheme: ShareThemePreference) => void
}) {
  return (
    <div className="share-floating-download-bar pointer-events-none fixed inset-x-0 bottom-[max(0.65rem,env(safe-area-inset-bottom,0px))] z-[60] px-3 print:hidden sm:bottom-4 sm:px-4">
      <div className="mx-auto w-full max-w-[38rem]">
        <div className="pointer-events-auto flex min-w-0 items-center justify-between gap-2 rounded-[0.9rem] border border-black/10 bg-white/95 px-2.5 py-1.5 shadow-[0_8px_20px_rgba(0,0,0,0.12)] backdrop-blur-sm dark:border-white/10 dark:bg-[#1f1f1f]/95 sm:gap-3 sm:px-3 sm:py-2">
          <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2">
            <a
              href={TILES_APP_ORIGIN}
              className="inline-flex shrink-0 items-center gap-2 transition-opacity hover:opacity-85 sm:gap-2.5"
            >
              <Image
                src="/icon-mark-transparent-white.svg"
                alt="Tiles"
                width={40}
                height={40}
                className="h-6 w-6 shrink-0 opacity-90 invert dark:invert-0 sm:h-7 sm:w-7"
              />
              <span className="shrink-0 text-sm font-semibold leading-none tracking-[-0.01em] text-[#1d1d1f] dark:text-[#e7e7ed] sm:text-base">
                Tiles
              </span>
            </a>
            <span className="inline-flex min-w-0 items-baseline">
              <span className="ml-0.5 hidden min-w-0 truncate text-xs leading-none text-black/55 dark:text-white/55 min-[430px]:inline sm:hidden">
                Own your AI
              </span>
              <span className="ml-0.5 hidden text-xs leading-none text-black/55 dark:text-white/55 sm:inline">
                Own your AI
              </span>
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            <button
              type="button"
              onClick={() =>
                onSetThemePreference(
                  themePreference === "light"
                    ? "dark"
                    : themePreference === "dark"
                      ? "system"
                      : "light",
                )
              }
              className="inline-flex h-8 w-8 items-center justify-center rounded-[0.65rem] text-[#1d1d1f]/85 transition-colors hover:text-[#1d1d1f] dark:text-[#e7e7ed]/90 dark:hover:text-[#e7e7ed]"
              aria-label={`Theme: ${themePreference}. Click to switch theme`}
              title={`Theme: ${themePreference}`}
            >
              {themePreference === "light" ? (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="h-4 w-4"
                  aria-hidden
                >
                  <path d="M10 2a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5A.75.75 0 0110 2zM10 15a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5A.75.75 0 0110 15zM10 7a3 3 0 100 6 3 3 0 000-6zM15.657 5.404a.75.75 0 10-1.06-1.06l-1.061 1.06a.75.75 0 001.06 1.061l1.06-1.06zM6.464 14.596a.75.75 0 10-1.06-1.06l-1.06 1.06a.75.75 0 001.06 1.06l1.06-1.06zM18 10a.75.75 0 01-.75.75h-1.5a.75.75 0 010-1.5h1.5A.75.75 0 0118 10zM5 10a.75.75 0 01-.75.75h-1.5a.75.75 0 010-1.5h1.5A.75.75 0 015 10zM14.596 15.657a.75.75 0 001.06-1.06l-1.06-1.061a.75.75 0 10-1.06 1.06l1.06 1.06zM5.404 6.464a.75.75 0 001.06-1.06l-1.06-1.06a.75.75 0 10-1.061 1.06l1.06 1.06z" />
                </svg>
              ) : themePreference === "dark" ? (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="h-4 w-4"
                  aria-hidden
                >
                  <path
                    fillRule="evenodd"
                    d="M7.455 2.004a.75.75 0 01.26.77 7 7 0 009.958 7.967.75.75 0 011.067.853A8.5 8.5 0 116.647 1.921a.75.75 0 01.808.083z"
                    clipRule="evenodd"
                  />
                </svg>
              ) : (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="h-4 w-4"
                  aria-hidden
                >
                  <path
                    fillRule="evenodd"
                    d="M2 4.25A2.25 2.25 0 014.25 2h11.5A2.25 2.25 0 0118 4.25v8.5A2.25 2.25 0 0115.75 15h-3.105a3.501 3.501 0 001.1 1.677A.75.75 0 0113.26 18H6.74a.75.75 0 01-.484-1.323A3.501 3.501 0 007.355 15H4.25A2.25 2.25 0 012 12.75v-8.5zm1.5 0a.75.75 0 01.75-.75h11.5a.75.75 0 01.75.75v7.5a.75.75 0 01-.75.75H4.25a.75.75 0 01-.75-.75v-7.5z"
                    clipRule="evenodd"
                  />
                </svg>
              )}
            </button>
            <a
              href={`${TILES_APP_ORIGIN}/download`}
              className="inline-flex h-8 items-center justify-center rounded-[0.65rem] border border-black/10 bg-black/[0.03] px-2.5 text-xs font-medium text-[#1d1d1f]/85 transition-colors hover:bg-black/[0.06] hover:text-[#1d1d1f] dark:border-white/10 dark:bg-white/[0.035] dark:text-[#e7e7ed]/90 dark:hover:bg-white/[0.08] dark:hover:text-[#e7e7ed] sm:px-3.5 sm:text-sm"
            >
              Download
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}

function CopyLinkButton({ pageUrl }: { pageUrl: string }) {
  const [copiedLink, setCopiedLink] = useState(false)

  return (
    <button
      type="button"
      onClick={() => {
        if (!pageUrl) {
          return
        }
        void navigator.clipboard.writeText(pageUrl).then(() => {
          setCopiedLink(true)
          window.setTimeout(() => setCopiedLink(false), 1200)
        })
      }}
      className="inline-flex h-5 w-5 items-center justify-center rounded-sm text-black/62 transition-colors hover:text-black dark:text-white/62 dark:hover:text-white"
      aria-label="Copy link"
      title="Copy link"
    >
      {copiedLink ? (
        <Check className="h-3.5 w-3.5" aria-hidden />
      ) : (
        <Copy className="h-3.5 w-3.5" aria-hidden />
      )}
    </button>
  )
}

export function ShareSessionClient({
  mockApiUrl,
  initialSharedSession = null,
  shareToken = "",
  initialErrorMessage = null,
}: ShareSessionClientProps) {
  const [sharedSession, setSharedSession] = useState<SharedSession | null>(
    initialSharedSession,
  )
  const [errorMessage, setErrorMessage] = useState<string | null>(
    initialErrorMessage,
  )
  const [pageUrl, setPageUrl] = useState<string>("")
  // null = the stored preference has not been read yet; the root class set by
  // the inline script in the layout is left untouched until then.
  const [themePreference, setThemePreference] =
    useState<ShareThemePreference | null>(null)
  const [mathPlugin, setMathPlugin] = useState<ShareMathPlugin | null>(null)

  useEffect(() => {
    if (!mockApiUrl) {
      return
    }
    let cancelled = false
    setSharedSession(null)
    setErrorMessage(null)

    void getSharedSessionFromMockApi(mockApiUrl).then(
      (session) => {
        if (cancelled) {
          return
        }
        setSharedSession(session)
      },
      (error: unknown) => {
        if (cancelled) {
          return
        }
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Unable to load this shared session.",
        )
      },
    )

    return () => {
      cancelled = true
    }
  }, [mockApiUrl])

  useEffect(() => {
    if (mockApiUrl || !shareToken) {
      return
    }
    let cancelled = false
    const load = async () => {
      try {
        const fragment = decodeURIComponent(window.location.hash.slice(1))
        const sharedSession = await getSharedSession(shareToken, fragment)

        if (!cancelled) {
          setSharedSession(sharedSession)
        }
      } catch (error: unknown) {
        if (!cancelled) {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : "Unable to load this shared session.",
          )
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [mockApiUrl, shareToken])

  useEffect(() => {
    if (!sharedSession || mathPlugin || !sessionHasMath(sharedSession)) {
      return
    }
    let cancelled = false

    void loadShareMathPlugin().then((plugin) => {
      if (!cancelled && plugin) {
        setMathPlugin(plugin)
      }
    })

    return () => {
      cancelled = true
    }
  }, [sharedSession, mathPlugin])

  useEffect(() => {
    setPageUrl(window.location.href)
    setThemePreference(readStoredShareTheme())
  }, [])

  useEffect(() => {
    if (themePreference === null) {
      return
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)")
    const shouldUseDark =
      themePreference === "system"
        ? mediaQuery.matches
        : themePreference === "dark"

    document.documentElement.classList.toggle("dark", shouldUseDark)
    writeStoredShareTheme(themePreference)

    if (themePreference !== "system") {
      return
    }

    const handleSystemThemeChange = (event: MediaQueryListEvent) => {
      document.documentElement.classList.toggle("dark", event.matches)
    }

    mediaQuery.addEventListener("change", handleSystemThemeChange)
    return () => {
      mediaQuery.removeEventListener("change", handleSystemThemeChange)
    }
  }, [themePreference])

  const sharedByLabel = useMemo(
    () => (sharedSession ? getSharedByLabel(sharedSession) : ""),
    [sharedSession],
  )

  const shareLinkLabel = useMemo(() => {
    return shortenShareLinkLabel(pageUrl)
  }, [pageUrl])
  const atprotoUriUrl = useMemo(
    () => buildAtprotoAtUriUrl(sharedSession?.sourceUri ?? ""),
    [sharedSession?.sourceUri],
  )
  const isTilesLexiconRecord = useMemo(
    () => isTilesSessionSnapshotRecord(sharedSession?.sourceUri ?? ""),
    [sharedSession?.sourceUri],
  )
  const blueskyProfileUrl = useMemo(() => {
    if (!sharedSession) {
      return ""
    }
    return buildBlueskyProfileUrl(
      sharedSession.sharedBy.handle,
      sharedSession.sharedBy.did,
    )
  }, [sharedSession])

  const activeThemePreference = themePreference ?? "system"

  if (errorMessage) {
    return (
      <main
        data-shared-session-page
        className="flex h-[100dvh] overflow-hidden bg-[#fbfbfd] pb-[max(1rem,env(safe-area-inset-bottom,0px))] pt-[calc(1rem+env(safe-area-inset-top,0px))] text-[#1d1d1f] dark:bg-[#1f1f1f] dark:text-[#E6E6E8] print:h-auto print:overflow-visible lg:min-h-screen lg:overflow-visible lg:pt-[calc(1.25rem+env(safe-area-inset-top,0px))]"
      >
        <ErrorState message={errorMessage} />
        <ShareFloatingDownloadBar
          themePreference={activeThemePreference}
          onSetThemePreference={setThemePreference}
        />
      </main>
    )
  }

  if (!sharedSession) {
    return (
      <main
        data-shared-session-page
        className="flex h-[100dvh] overflow-hidden bg-[#fbfbfd] px-4 pb-[max(1rem,env(safe-area-inset-bottom,0px))] pt-[calc(1rem+env(safe-area-inset-top,0px))] text-[#1d1d1f] dark:bg-[#1f1f1f] dark:text-[#E6E6E8] print:h-auto print:overflow-visible sm:px-6 lg:px-8 lg:pt-[calc(1.25rem+env(safe-area-inset-top,0px))]"
      >
        <section className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col">
          <div className="flex min-h-0 flex-1 items-center justify-center">
            <p className="w-full text-center text-sm text-black/55 dark:text-white/55">
              <span className="inline-flex max-w-full items-center whitespace-nowrap">
                <span>Loading shared chat...</span>
              </span>
            </p>
          </div>
        </section>
        <ShareFloatingDownloadBar
          themePreference={activeThemePreference}
          onSetThemePreference={setThemePreference}
        />
      </main>
    )
  }

  return (
    <main
      data-shared-session-page
      className="flex h-[100dvh] overflow-hidden bg-[#fbfbfd] px-4 pb-[max(1rem,env(safe-area-inset-bottom,0px))] pt-[calc(1rem+env(safe-area-inset-top,0px))] text-[#1d1d1f] dark:bg-[#1f1f1f] dark:text-[#E6E6E8] print:h-auto print:overflow-visible print:pb-0 sm:px-6 lg:px-8 lg:pt-[calc(1.25rem+env(safe-area-inset-top,0px))]"
    >
      <section className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col overflow-hidden">
        <div className="native-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-[calc(4.5rem+env(safe-area-inset-bottom,0px))] [scrollbar-gutter:stable] print:overflow-visible print:pb-4">
          <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col overflow-x-hidden">
            <header className="relative flex flex-col gap-3 px-4 pb-7 pt-4 pr-[5.75rem] print:flex-row print:flex-nowrap print:items-start print:justify-between print:gap-x-6 print:px-2 print:pr-2 sm:px-5 sm:pb-8 sm:pr-[6.25rem] sm:pt-4">
              <SharePageQrCode
                url={pageUrl}
                size={80}
                className="absolute right-0 top-0 print:static print:float-right"
              />
              <div className="flex min-w-0 max-w-full items-center justify-start gap-2.5 text-left text-xs leading-5 text-black/68 dark:text-white/72 print:max-w-[42%] sm:gap-2">
                <span
                  className="min-w-0 truncate font-medium"
                  title={pageUrl || undefined}
                >
                  {shareLinkLabel}
                </span>
                <span className="shrink-0 rounded-sm border border-black/12 px-1.5 py-0.5 text-[0.65rem] font-medium leading-4 text-black/66 dark:border-white/16 dark:text-white/72">
                  {sharedSession.isPrivateLink ? "Private link" : "Public link"}
                </span>
                <CopyLinkButton pageUrl={pageUrl} />
                <button
                  type="button"
                  onClick={() =>
                    downloadMarkdownTranscript(
                      sharedSession,
                      sharedByLabel,
                      pageUrl,
                    )
                  }
                  className="inline-flex h-5 w-5 items-center justify-center rounded-sm text-black/62 transition-colors hover:text-black dark:text-white/62 dark:hover:text-white"
                  aria-label="Download transcript as Markdown"
                  title="Download transcript"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
              <p className="max-w-full text-left text-xs leading-5 text-black/60 dark:text-white/65 sm:text-[0.8rem] print:max-w-none print:whitespace-nowrap">
                {sharedSession.isPrivateLink
                  ? "This is a private copy of a conversation between Tiles and"
                  : "This is a public copy of a conversation between Tiles and"}{" "}
                <span className="inline-flex max-w-full items-center gap-1.5 align-[-0.2em] whitespace-nowrap">
                  {sharedSession.sharedBy.avatarUrl ? (
                    <img
                      src={sharedSession.sharedBy.avatarUrl}
                      alt={sharedByLabel}
                      className="h-4 w-4 rounded-full object-cover"
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <span
                      className="h-4 w-4 rounded-full bg-black/15 dark:bg-white/25"
                      aria-hidden
                    />
                  )}
                  <a
                    href={blueskyProfileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-black/65 underline decoration-black/20 underline-offset-2 transition-colors hover:text-black/85 hover:decoration-black/35 dark:text-white/75 dark:decoration-white/25 dark:hover:text-white dark:hover:decoration-white/40"
                    title="Open Bluesky profile"
                  >
                    {sharedSession.sharedBy.handle
                      ? `@${sharedSession.sharedBy.handle.replace(/^@+/, "")}`
                      : sharedByLabel}
                  </a>
                </span>
              </p>
            </header>

            {sharedSession.messages.length > 0 ? (
              <MathPluginContext.Provider value={mathPlugin}>
                <div className="flex min-w-0 flex-col gap-6 py-5 sm:gap-7 sm:py-3">
                  {sharedSession.messages.map((message, index) => (
                    <MessageBubble
                      key={`${message.role}-${index}`}
                      message={message}
                      modelLabel={
                        message.model ?? sharedSession.modelsUsed[0] ?? null
                      }
                    />
                  ))}
                </div>
              </MathPluginContext.Provider>
            ) : (
              <EmptyState />
            )}

            <footer className="mt-auto pt-5">
              <div className="border-t border-black/10 pt-3 dark:border-white/10">
                <p className="text-left text-[0.68rem] leading-4 text-black/55 dark:text-white/55 sm:text-[0.72rem]">
                  <span className="block">
                    We do not store a copy of the shared conversation on our
                    servers.
                  </span>
                  <span className="mt-1 block">
                    For private links, the key stays in the URL and is never
                    sent to the server. It&apos;s used to decrypt the chat
                    transcript stored on the user&apos;s PDS.
                  </span>
                  <span className="mt-1 block">
                    <span>
                      {isTilesLexiconRecord
                        ? "Data is fetched from the user's PDS as a Tiles lexicon record "
                        : "Data is fetched from the user's PDS "}
                    </span>
                    {atprotoUriUrl ? (
                      <a
                        href={atprotoUriUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline decoration-black/25 underline-offset-2 transition-colors hover:text-black/70 hover:decoration-black/40 dark:decoration-white/25 dark:hover:text-white/70 dark:hover:decoration-white/40"
                      >
                        {sharedSession.sourceUri}
                      </a>
                    ) : (
                      <span>{sharedSession.sourceUri}</span>
                    )}
                    <span>.</span>
                  </span>
                </p>
              </div>
            </footer>
          </div>
        </div>
      </section>
      <ShareFloatingDownloadBar
        themePreference={activeThemePreference}
        onSetThemePreference={setThemePreference}
      />
    </main>
  )
}
