"use client"

import QRCode from "react-qr-code"
import { cn } from "@/lib/utils"

const QR_THEME = {
  light: {
    bgColor: "transparent",
    fgColor: "#000000",
  },
  dark: {
    bgColor: "transparent",
    fgColor: "#ffffff",
  },
} as const

interface SharePageQrCodeProps {
  url: string
  className?: string
  isDark?: boolean
  size?: number
}

export function SharePageQrCode({
  url,
  className,
  isDark = false,
  size = 80,
}: SharePageQrCodeProps) {
  if (!url) {
    return null
  }

  const theme = isDark ? QR_THEME.dark : QR_THEME.light

  return (
    <span
      className={cn("inline-flex shrink-0 bg-transparent", className)}
      title={`Scan to open: ${url}`}
      aria-label="QR code for this share link"
    >
      <QRCode
        value={url}
        size={size}
        bgColor={theme.bgColor}
        fgColor={theme.fgColor}
        level="M"
        className="block h-auto w-auto max-w-none"
      />
    </span>
  )
}
