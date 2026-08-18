"use client"

import QRCode from "react-qr-code"
import { cn } from "@/lib/utils"

interface SharePageQrCodeProps {
  url: string
  className?: string
  size?: number
}

export function SharePageQrCode({
  url,
  className,
  size = 80,
}: SharePageQrCodeProps) {
  if (!url) {
    return null
  }

  return (
    <span
      className={cn(
        "inline-flex shrink-0 bg-transparent text-black dark:text-white",
        className,
      )}
      title={`Scan to open: ${url}`}
      aria-label="QR code for this share link"
    >
      <QRCode
        value={url}
        size={size}
        bgColor="transparent"
        fgColor="currentColor"
        level="M"
        className="block h-auto w-auto max-w-none"
      />
    </span>
  )
}
