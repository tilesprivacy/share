import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Shared chat session | Tiles",
  description: "Shared public chat session on Tiles. Powered by ATProto.",
  openGraph: {
    title: "Shared chat session | Tiles",
    description: "Shared public chat session on Tiles. Powered by ATProto.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Shared chat session | Tiles",
    description: "Shared public chat session on Tiles. Powered by ATProto.",
  },
}

export default function ShareLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children
}
