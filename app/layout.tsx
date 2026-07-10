import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import { SHARE_APP_ORIGIN } from "@/lib/site-url";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(SHARE_APP_ORIGIN),
  title: "Tiles Share | Shared chat links",
  description:
    "View and share Tiles chat sessions through ATproto-backed public and private links.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const themeScript = `
    try {
      var stored = window.localStorage.getItem("share-page-theme");
      var prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      var useDark = stored === "dark" || (stored !== "light" && prefersDark);
      document.documentElement.classList.toggle("dark", useDark);
    } catch {
      document.documentElement.classList.toggle("dark", window.matchMedia("(prefers-color-scheme: dark)").matches);
    }
  `;

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col">
        <Script id="share-theme" strategy="beforeInteractive">
          {themeScript}
        </Script>
        {children}
      </body>
    </html>
  );
}
