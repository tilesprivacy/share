import type { Metadata } from "next"
import { SHARE_APP_ORIGIN } from "@/lib/site-url"
import { ShareSessionClient } from "../[...session]/share-session-client"

export const metadata: Metadata = {
  title: "Shared chat session | Tiles",
  description: "Shared public chat session on Tiles. Powered by ATProto.",
  openGraph: {
    title: "Shared chat session | Tiles",
    description: "Shared public chat session on Tiles. Powered by ATProto.",
    images: [
      {
        url: `${SHARE_APP_ORIGIN}/api/share/og`,
        width: 1200,
        height: 630,
        alt: "Shared public chat session on Tiles. Powered by ATProto.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Shared chat session | Tiles",
    description: "Shared public chat session on Tiles. Powered by ATProto.",
    images: [`${SHARE_APP_ORIGIN}/api/share/og`],
  },
}

interface ShareMockPageProps {
  searchParams?: Promise<{
    turns?: string
    sessionId?: string
    name?: string
    private?: string
  }>
}

export default async function ShareMockPage({
  searchParams,
}: ShareMockPageProps) {
  const params = searchParams ? await searchParams : undefined
  const query = new URLSearchParams()

  if (params?.turns) {
    query.set("turns", params.turns)
  }
  if (params?.sessionId) {
    query.set("sessionId", params.sessionId)
  }
  if (params?.name) {
    query.set("name", params.name)
  }
  if (params?.private) {
    query.set("private", params.private)
  }

  const queryString = query.toString()
  const mockApiUrl = queryString
    ? `/api/share/mock?${queryString}`
    : "/api/share/mock"

  return <ShareSessionClient mockApiUrl={mockApiUrl} />
}
