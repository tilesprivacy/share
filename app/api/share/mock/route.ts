import { NextResponse } from "next/server"

type MockRole = "user" | "assistant"

interface MockMessage {
  role: MockRole
  content: string
}

interface MockSharedSessionResponse {
  schemaVersion: "1.0"
  sessionId: string
  name: string
  isPrivateLink: boolean
  createdAt: string
  sourceUri: string
  modelsUsed: string[]
  sharedBy: {
    did: string
    handle: string
    displayName: string
    avatarUrl: string
  }
  messages: MockMessage[]
}

function parseTurns(value: string | null): number {
  const parsed = Number.parseInt(value ?? "", 10)
  if (Number.isNaN(parsed)) {
    return 14
  }

  return Math.min(Math.max(parsed, 2), 40)
}

function buildMockMessages(turns: number): MockMessage[] {
  const messages: MockMessage[] = []

  for (let index = 0; index < turns; index += 1) {
    const turn = index + 1
    const role: MockRole = index % 2 === 0 ? "user" : "assistant"

    if (role === "user") {
      messages.push({
        role,
        content:
          turn === 1
            ? "I want to redesign the shared link page. Keep it minimal and easy to scan."
            : `User turn ${turn}: Add one more UI refinement to spacing and typography.`,
      })
      continue
    }

    messages.push({
      role,
      content:
        turn === 2
          ? "Great. I can help you iterate quickly. We can test header hierarchy, message rhythm, and footer readability."
          : `Assistant turn ${turn}: Applied the requested change and kept the visual hierarchy consistent.`,
    })
  }

  return messages
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const turns = parseTurns(url.searchParams.get("turns"))
  const sessionId = url.searchParams.get("sessionId") ?? "mock-share-session"
  const name = url.searchParams.get("name") ?? "Mock shared chat for UI"

  const payload: MockSharedSessionResponse = {
    schemaVersion: "1.0",
    sessionId,
    name,
    isPrivateLink: url.searchParams.get("private") === "1",
    createdAt: new Date().toISOString(),
    sourceUri: "at://did:plc:mockaccount123/run.tiles.session/mockrkey123",
    modelsUsed: ["mlx-community/Qwen3.5-4B-MLX-4bit"],
    sharedBy: {
      did: "did:plc:mockaccount123",
      handle: "mockuser.bsky.social",
      displayName: "Mock User",
      avatarUrl:
        "https://api.dicebear.com/9.x/identicon/svg?seed=tiles-mock-user",
    },
    messages: buildMockMessages(turns),
  }

  return NextResponse.json(payload, {
    headers: {
      "cache-control": "no-store",
    },
  })
}
