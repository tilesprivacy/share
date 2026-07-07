const CODE_FENCE_PATTERN = /(```[\s\S]*?```)/g
const INLINE_CODE_PATTERN = /(`+[^`]*?`+)/g

function convertLatexDelimiters(segment: string): string {
  return segment
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, math) => `\n\n$$\n${math.trim()}\n$$\n\n`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_, math) => `$${math.trim()}$`)
}

function convertLatexDelimitersOutsideInlineCode(segment: string): string {
  return segment
    .split(INLINE_CODE_PATTERN)
    .map((part) => (part.startsWith("`") ? part : convertLatexDelimiters(part)))
    .join("")
}

/**
 * Tiles assistant output uses LaTeX \( \) and \[ \] delimiters; remark-math expects $.
 * Skips fenced and inline code so literals are left untouched.
 */
export function normalizeShareMathMarkdown(markdown: string): string {
  return markdown
    .split(CODE_FENCE_PATTERN)
    .map((part) =>
      part.startsWith("```")
        ? part
        : convertLatexDelimitersOutsideInlineCode(part),
    )
    .join("")
}
