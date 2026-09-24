import { mergeAttributes } from "@tiptap/core";
import { Image } from "@tiptap/extension-image";

import { textAttribute } from "./attributes";
import {
  BACKSLASH_ESCAPE,
  markdownDestination,
  markdownTitle,
} from "./markdown-escape";

export function isSafeMarkdownLink(value: unknown) {
  if (typeof value !== "string") {
    return false;
  }
  const url = value.trim();
  if (
    !url ||
    [...url].some(
      // The spread iterator yields code points; charCodeAt reads the first
      // UTF-16 unit which is sufficient for the ASCII control-range check.
      (character) =>
        // oxlint-disable-next-line unicorn/prefer-code-point
        character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127
    )
  ) {
    return false;
  }
  // `/\x` normalizes to `//x` under WHATWG URL resolution, escaping the
  // origin; require the character after `/` to be neither `/` nor `\`.
  if (/^(?:#|\/(?![/\\])|\.\.?\/)/u.test(url)) {
    return true;
  }
  try {
    return ["https:", "http:", "mailto:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

export const SafeImage = Image.extend({
  // Emphasis marks around a leaf image serialize dangling delimiters, while a
  // linked image `[![alt](src)](href)` is valid Markdown worth keeping.
  marks: "link",
  renderHTML({ HTMLAttributes }) {
    const src =
      typeof HTMLAttributes.src === "string" ? HTMLAttributes.src : "";
    const safe = isSafeMarkdownLink(src) && !/^mailto:/iu.test(src);
    return [
      "img",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        src: safe ? src : undefined,
      }),
    ];
  },
  renderMarkdown(node) {
    const src = textAttribute(node.attrs?.src);
    const alt = textAttribute(node.attrs?.alt).replace(
      /([\\[\]])/gu,
      BACKSLASH_ESCAPE
    );
    const image = `![${alt}](${markdownDestination(src)}${markdownTitle(
      textAttribute(node.attrs?.title)
    )})`;
    // The serializer only emits mark delimiters around text nodes, so a link
    // mark on this leaf is wrapped here to keep `[![alt](src)](href)` intact.
    const link = (node.marks ?? []).find((mark) => mark.type === "link");
    return link
      ? `[${image}](${markdownDestination(
          textAttribute(link.attrs?.href)
        )}${markdownTitle(textAttribute(link.attrs?.title))})`
      : image;
  },
});
