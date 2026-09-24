/** Tiptap's attribute maps accept arbitrary values from document JSON and pasted HTML. */
export function textAttribute(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}
