import Image from "next/image";
import { SiteFooter } from "@/components/site-footer";
import banner from "@/public/atmospheric-banner.webp";

const bannerAlt =
  "@tmopsheric — Atmospheric sessions wordmark floating above the clouds";

export default function Home() {
  return (
    <main className="relative h-dvh w-full overflow-hidden bg-[#bdd8f3]">
      {/* Ambient fill: blurred cover copy of the banner, visible wherever the
          sharp layer doesn't reach (portrait letterboxing). Same asset, so it
          resolves to the already-fetched image. */}
      <Image
        src={banner}
        alt=""
        fill
        sizes="110vw"
        placeholder="blur"
        className="scale-110 object-cover blur-2xl"
      />

      {/* Portrait: banner at its intrinsic 3:2 ratio, vertically centered,
          top/bottom edges feathered into the blurred backdrop so the
          wordmark is never cropped and there is no visible seam. */}
      <div className="absolute inset-x-0 top-1/2 hidden -translate-y-1/2 portrait:block">
        <Image
          src={banner}
          alt={bannerAlt}
          sizes="100vw"
          placeholder="blur"
          preload
          className="h-auto w-full [mask-image:linear-gradient(to_bottom,transparent,black_18%,black_82%,transparent)]"
        />
      </div>

      {/* Landscape: true full-bleed cover; at landscape aspect ratios the 3:2
          frame is never cropped past the wordmark. */}
      <Image
        src={banner}
        alt={bannerAlt}
        fill
        sizes="100vw"
        placeholder="blur"
        preload
        className="hidden object-cover landscape:block"
      />

      <header className="absolute inset-x-0 top-0 z-10 px-5 pt-5 md:px-6 md:pt-6">
        <a
          href="https://tiles.run"
          aria-label="Tiles home"
          className="inline-flex items-center gap-1.5 text-base font-bold text-black"
        >
          <Image src="/lighticon.png" alt="" width={24} height={24} />
          <span>Tiles</span>
        </a>
      </header>

      {/* Sits below the baked-in wordmark at every viewport size: 62% of the
          viewport on tall screens, pushed further down by 6.7vw when width
          (and thus the cover-scaled artwork) outgrows the viewport height. */}
      <div className="absolute inset-x-0 top-[max(62%,50%_+_6.7vw)] flex justify-center px-6">
        <a
          href="https://www.tiles.run/blog/atmospheric-sessions"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block px-3 py-2.5 text-center text-sm font-semibold text-black underline decoration-transparent underline-offset-4 transition hover:decoration-current sm:px-5 sm:text-base"
        >
          Learn more about Atmospheric sessions&nbsp;↗
        </a>
      </div>

      <SiteFooter />
    </main>
  );
}
