import type { Metadata } from "next"
import {
  getAtprotoData,
  isEncryptedSharedSessionRecord,
} from "@/lib/shared-session"
import { SHARE_APP_ORIGIN } from "@/lib/site-url"
import { ShareSessionClient } from "./share-session-client"

interface SharePageProps {
  params: Promise<{ session: string[] }>
}

const DEFAULT_SHARED_SESSION_DESCRIPTION =
  "Shared public chat session on Tiles. Powered by AT Protocol."

function getSharedSessionDescription(isPrivateLink = false): string {
  return isPrivateLink
    ? "Shared private chat session on Tiles. Powered by AT Protocol."
    : DEFAULT_SHARED_SESSION_DESCRIPTION
}

function getSharedSessionTitle(
  handle: string | null,
  isPrivateLink = false,
): string {
  const trimmedHandle = handle?.trim().replace(/^@+/, "")
  const prefix = isPrivateLink
    ? "Private shared chat session"
    : "Shared chat session"

  return trimmedHandle
    ? `${prefix} by @${trimmedHandle} | Tiles`
    : `${prefix} | Tiles`
}

export async function generateMetadata({
  params,
}: SharePageProps): Promise<Metadata> {
  const { session } = await params
  const shareToken = session.join("/")
  const imagePath = `${SHARE_APP_ORIGIN}/api/og?session=${encodeURIComponent(shareToken)}`
  let title = "Shared chat session | Tiles"
  let description = DEFAULT_SHARED_SESSION_DESCRIPTION

  try {
    // Metadata streams for browsers, so this fetch only delays HTML-limited
    // bots (link unfurlers); the timeout keeps a slow PDS from hanging them.
    const at_data = await getAtprotoData(shareToken, {
      signal: AbortSignal.timeout(5_000),
    })
    const isPrivateLink = isEncryptedSharedSessionRecord(at_data.record)
    title = getSharedSessionTitle(at_data.sharedBy.handle, isPrivateLink)
    description = getSharedSessionDescription(isPrivateLink)
  } catch {
    title = "Shared chat session | Tiles"
    description = DEFAULT_SHARED_SESSION_DESCRIPTION
  }

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [
        {
          url: imagePath,
          width: 1200,
          height: 630,
          alt: description,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [imagePath],
    },
  }
}

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function SharePage({ params }: SharePageProps) {
  const { session } = await params
  const shareToken = session.join("/")

  return (
    <>
      {/* Hoisted into <head> so the browser warms up the hosts the
          client-side PDS fetch waterfall hits, before any JS runs. */}
      <link rel="preconnect" href="https://plc.directory" />
      <link rel="preconnect" href="https://public.api.bsky.app" />
      <link rel="dns-prefetch" href="https://cdn.bsky.app" />
      <ShareSessionClient shareToken={shareToken} />
    </>
  )
}
