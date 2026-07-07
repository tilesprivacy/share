import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Calculate reading time in minutes based on word count
 * Uses average reading speed of 200 words per minute
 */
export function calculateReadingTime(text: string): number {
  // Remove HTML tags and extract text
  const plainText = text.replace(/<[^>]*>/g, ' ')
  // Count words (split by whitespace and filter empty strings)
  const wordCount = plainText.trim().split(/\s+/).filter(word => word.length > 0).length
  // Calculate minutes (200 words per minute)
  const minutes = Math.ceil(wordCount / 200)
  return Math.max(1, minutes) // At least 1 minute
}
