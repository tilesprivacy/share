import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { ImageResponse } from "next/og"
import {
  getAtprotoData,
  isEncryptedSharedSessionRecord,
} from "@/lib/shared-session"

export const runtime = "nodejs"

export const size = {
  width: 1200,
  height: 630,
}

export const contentType = "image/png"

// Crawlers (Twitterbot, Bluesky's cardyb) fetch this image once and cache the
// result on their side, so a render that silently dropped the avatar sticks in
// unfurls long after the upstream recovers. Fetch budgets below keep the total
// render inside a crawler's patience; cache headers keep good renders at the
// CDN and bad ones out of it.
const AVATAR_FETCH_ATTEMPT_TIMEOUT_MS = 2_500
const AVATAR_FETCH_TOTAL_BUDGET_MS = 6_000

function normalizeAvatarUrlForOg(imageUrl: string): string {
  try {
    const parsed = new URL(imageUrl)
    if (parsed.hostname !== "cdn.bsky.app") {
      return imageUrl
    }

    const segments = parsed.pathname.split("/")
    const lastSegment = segments[segments.length - 1]
    if (!lastSegment) {
      return imageUrl
    }

    if (!lastSegment.includes("@")) {
      segments[segments.length - 1] = `${lastSegment}@jpeg`
      parsed.pathname = segments.join("/")
    }

    return parsed.toString()
  } catch {
    return imageUrl
  }
}

async function fetchImageAsDataUrl(
  imageUrl: string,
  deadline: AbortSignal,
): Promise<string | null> {
  try {
    const response = await fetch(imageUrl, {
      // Avatar URLs are CID-addressed (a new upload gets a new URL), so the
      // bytes are immutable and safe to keep in the data cache; a warm cache
      // also means a cdn.bsky.app hiccup can't strip the avatar from a render.
      cache: "force-cache",
      signal: AbortSignal.any([
        deadline,
        AbortSignal.timeout(AVATAR_FETCH_ATTEMPT_TIMEOUT_MS),
      ]),
    })
    if (!response.ok) {
      return null
    }

    const contentType = response.headers.get("content-type") ?? "image/png"
    const bytes = await response.arrayBuffer()
    const base64 = Buffer.from(bytes).toString("base64")
    return `data:${contentType};base64,${base64}`
  } catch {
    return null
  }
}

async function toDataUrl(imageUrl: string): Promise<string | null> {
  const normalized = normalizeAvatarUrlForOg(imageUrl)
  const candidates =
    normalized === imageUrl ? [normalized] : [normalized, imageUrl]
  const deadline = AbortSignal.timeout(AVATAR_FETCH_TOTAL_BUDGET_MS)

  // One retry pass over the candidates so a single transient upstream failure
  // doesn't bake the placeholder into an unfurl a crawler then caches.
  for (const candidate of [...candidates, ...candidates]) {
    if (deadline.aborted) {
      break
    }
    const dataUrl = await fetchImageAsDataUrl(candidate, deadline)
    if (dataUrl) {
      return dataUrl
    }
  }

  return null
}

let logoDataUrlPromise: Promise<string | null> | null = null

function getLogoDataUrl(): Promise<string | null> {
  logoDataUrlPromise ??= readFile(
    join(process.cwd(), "public", "icon-mark-light.svg"),
  )
    .then((bytes) => `data:image/svg+xml;base64,${bytes.toString("base64")}`)
    .catch(() => {
      logoDataUrlPromise = null
      return null
    })
  return logoDataUrlPromise
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const shareToken = url.searchParams.get("session") ?? ""

  let handleText = "@unknown"
  let avatarDataUrl: string | null = null
  let isPrivateLink = false
  let shareVisibilityText = "Public"
  const [logoDataUrl, atData] = await Promise.all([
    getLogoDataUrl(),
    getAtprotoData(shareToken, { signal: AbortSignal.timeout(5_000) }).catch(
      () => null,
    ),
  ])

  let avatarExpected = false
  if (atData) {
    isPrivateLink = isEncryptedSharedSessionRecord(atData.record)
    shareVisibilityText = isPrivateLink ? "Private" : "Public"
    const handle = atData.sharedBy.handle?.trim()
    handleText = handle
      ? handle.startsWith("@")
        ? handle
        : `@${handle}`
      : `@${atData.sharedBy.did}`
    avatarExpected = Boolean(atData.sharedBy.avatarUrl)
    avatarDataUrl = atData.sharedBy.avatarUrl
      ? await toDataUrl(atData.sharedBy.avatarUrl)
      : null
  }

  // A complete render is safe to hold at the CDN, which keeps crawler fetches
  // fast and off the upstream waterfall. A degraded one (record or avatar
  // missing) must not be cached anywhere, or the broken unfurl outlives the
  // outage that caused it.
  const isCompleteRender = atData !== null && (!avatarExpected || avatarDataUrl)
  const cacheControl = isCompleteRender
    ? "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400"
    : "no-store"

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        background: "#000000",
        color: "#e7e7ed",
        padding: "56px",
        fontFamily:
          "Geist, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "20px",
          marginBottom: "38px",
        }}
      >
        {logoDataUrl ? (
          <img
            src={logoDataUrl}
            alt="Tiles"
            width={132}
            height={132}
            style={{ objectFit: "contain" }}
          />
        ) : null}
        <div
          style={{
            fontSize: 72,
            fontWeight: 700,
            letterSpacing: "-0.02em",
            color: "#f2f2f4",
          }}
        >
          Tiles
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "10px",
          lineHeight: 1.2,
          textAlign: "center",
          whiteSpace: "nowrap",
          fontSize: 28,
          fontWeight: 500,
          color: "rgba(231,231,237,0.88)",
        }}
      >
        <span>{shareVisibilityText} chat session shared by</span>
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            fontSize: 28,
            color: "rgba(231,231,237,0.95)",
          }}
        >
          {avatarDataUrl ? (
            <img
              src={avatarDataUrl}
              alt={handleText}
              width={44}
              height={44}
              style={{
                borderRadius: "9999px",
                objectFit: "cover",
                border: "2px solid rgba(255,255,255,0.2)",
              }}
            />
          ) : (
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: "9999px",
                background: "rgba(255,255,255,0.14)",
                border: "2px solid rgba(255,255,255,0.2)",
              }}
            />
          )}
          <span>{handleText}</span>
        </span>
      </div>
    </div>,
    {
      width: size.width,
      height: size.height,
      headers: {
        "cache-control": cacheControl,
      },
    },
  )
}
