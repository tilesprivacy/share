import Image from "next/image";
import Link from "next/link";

const exampleHash =
  "YXQ6Ly9kaWQ6cGxjOm1iazZ3Z214aWF0b3R6eTViM3E1N25hdy9ydW4udGlsZXMuY2hhdC5zZXNzaW9uU25hcHNob3QvM21wem5zNTVjbDYyaA==";

export default function Home() {
  return (
    <main className="min-h-[100dvh] bg-background px-5 py-5 text-sm leading-6 text-foreground sm:px-8">
      <header className="flex max-w-3xl items-center font-mono">
        <Link
          href="https://tiles.run"
          className="inline-flex items-center gap-2 text-foreground underline decoration-transparent underline-offset-4 hover:decoration-current"
        >
          <span className="relative size-5 shrink-0">
            <Image
              src="/lighticon.png"
              alt=""
              fill
              sizes="20px"
              className="object-contain dark:hidden"
              priority
            />
            <Image
              src="/grey.png"
              alt=""
              fill
              sizes="20px"
              className="hidden object-contain dark:block"
              priority
            />
          </span>
          <span>Tiles</span>
        </Link>
      </header>

      <section className="mt-20 max-w-3xl sm:mt-28">
        <h1 className="mt-4 max-w-2xl text-4xl font-normal leading-tight tracking-normal text-foreground sm:text-5xl">
          Shared chat links for Tiles conversations.
        </h1>
        <p className="mt-6 max-w-2xl text-base leading-7 text-muted-foreground">
          Tiles Share opens chat sessions created from the Tiles app. Links
          resolve to ATProto-backed records, so conversations can be shared
          without copying a transcript into another service.
        </p>
      </section>

      <section className="mt-12 grid max-w-3xl gap-10 border-t border-border pt-8 sm:grid-cols-[10rem_1fr]">
        <h2 className="font-mono text-xs font-normal uppercase tracking-[0.18em] text-muted-foreground">
          Usage
        </h2>
        <div className="space-y-5">
          <p className="text-muted-foreground">
            In a Tiles chat, run one of these slash commands:
          </p>
          <pre className="overflow-x-auto font-mono text-sm leading-6 text-foreground">{`/share
/share <sessionId>`}</pre>
          <p className="text-muted-foreground">
            The resulting link opens in this shape:
          </p>
          <pre className="overflow-x-auto font-mono text-sm leading-6 text-foreground">{`https://chat.tiles.run/<conversation-ID>`}</pre>
        </div>
      </section>

      <section className="mt-10 grid max-w-3xl gap-10 border-t border-border pt-8 sm:grid-cols-[10rem_1fr]">
        <h2 className="font-mono text-xs font-normal uppercase tracking-[0.18em] text-muted-foreground">
          How It Works
        </h2>
        <div className="space-y-4 text-muted-foreground">
          <p>
            Public links resolve to a chat record on the user&apos;s ATProto
            personal data server.
          </p>
          <p>
            Private links store an encrypted transcript on the user&apos;s PDS.
            The decryption key lives in the URL fragment and is not sent to the
            server.
          </p>
          <p>Tiles does not store a copy of the shared conversation here.</p>
        </div>
      </section>

      <section className="mt-10 grid max-w-3xl gap-10 border-t border-border pt-8 sm:grid-cols-[10rem_1fr]">
        <h2 className="font-mono text-xs font-normal uppercase tracking-[0.18em] text-muted-foreground">
          Links
        </h2>
        <div className="space-y-3 font-mono">
          <Link
            href={`/${exampleHash}`}
            className="underline decoration-muted-foreground underline-offset-4 hover:decoration-current"
          >
            example shared chat
          </Link>
          <br />
          <Link
            href="https://tiles.run/book/manual#sharing-commands"
            className="text-muted-foreground underline decoration-transparent underline-offset-4 hover:text-foreground hover:decoration-current"
          >
            sharing commands in the manual
          </Link>
        </div>
      </section>

      <footer className="mt-16 max-w-3xl border-t border-border py-6 font-mono text-xs leading-5 text-muted-foreground">
        © 2026{" "}
        <a
          href="https://www.tilesprivacy.org"
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-transparent underline-offset-4 hover:text-foreground hover:decoration-current"
        >
          Tiles Privacy
        </a>
        . All rights reserved.
      </footer>
    </main>
  );
}
