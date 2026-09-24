export const BACKSLASH_ESCAPE = String.raw`\$1`;

// Whitespace, parens, quotes and angle brackets break plain `(href)`
// destinations; `<href>` keeps them parseable (backslashes and brackets
// escaped inside).
export function markdownDestination(href: string) {
  return /[\s()<>"\\]/u.test(href)
    ? `<${href.replace(/([\\<>])/gu, BACKSLASH_ESCAPE)}>`
    : href;
}

export function markdownTitle(title: string) {
  return title ? ` "${title.replace(/(["\\])/gu, BACKSLASH_ESCAPE)}"` : "";
}
