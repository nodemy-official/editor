import { mergeAttributes } from "@tiptap/core";
import type { MarkdownParseHelpers, MarkdownToken } from "@tiptap/core";
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
  if (!url || /[\u0000-\u001f\u007f]/u.test(value)) {
    return false;
  }

  // Keep explicit schemes on the allowlist. In particular, don't mistake an
  // unknown scheme such as `javascript:` for a relative path.
  const hasScheme = /^[a-z][a-z\d+.-]*:/iu.test(url);
  try {
    if (hasScheme) {
      return ["https:", "http:", "mailto:", "tel:"].includes(
        new URL(url).protocol
      );
    }

    // WHATWG URL parsing treats backslashes like slashes in special URLs.
    // Reject references that would become protocol-relative (`/\\host` or
    // `\\\\host`) before resolving them against the editor's origin.
    if (url.replaceAll("\\", "/").startsWith("//")) {
      return false;
    }

    const base = new URL("https://markdown-editor.invalid/");
    return new URL(url, base).origin === base.origin;
  } catch {
    return false;
  }
}

export const SafeImage = Image.extend({
  // Emphasis marks around a leaf image serialize dangling delimiters, while a
  // linked image `[![alt](src)](href)` is valid Markdown worth keeping.
  marks: "link",
  parseMarkdown(token: MarkdownToken, helpers: MarkdownParseHelpers) {
    // Marked already removes escapes before brackets, but leaves escaped
    // backslashes and backticks in image alt text. Decode those pairs so the
    // serializer can escape them without adding characters on every save.
    const alt = textAttribute(token.text).replace(
      /\\([\\`])/gu,
      (_match, character: string) => character
    );
    return helpers.createNode("image", {
      src: token.href,
      title: token.title,
      alt,
    });
  },
  renderHTML({ HTMLAttributes }) {
    const src =
      typeof HTMLAttributes.src === "string" ? HTMLAttributes.src : "";
    const safe = isSafeMarkdownLink(src) && !/^(?:mailto|tel):/iu.test(src.trim());
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
      /([\\[\]`])/gu,
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
