import { MarkdownManager } from "@tiptap/markdown";
import { describe, expect, it } from "vitest";

import { createMarkdownEditorExtensions } from "./markdown-editor-extensions";

const manager = new MarkdownManager({
  extensions: createMarkdownEditorExtensions(),
  markedOptions: { gfm: true },
});

describe("image alt Markdown round trips", () => {
  it.each([
    "a\\b",
    "a\\",
    "a`b",
    "a\\[b",
    "a\\]b",
    "a\\`b",
  ])("preserves alt text %j across repeated saves", (alt) => {
    const document = {
      type: "doc",
      content: [{ type: "image", attrs: { src: "image.png", alt } }],
    };
    const markdown = manager.serialize(document);
    const reparsed = manager.parse(markdown);

    expect(reparsed.content?.[0]?.type).toBe("image");
    expect(reparsed.content?.[0]?.attrs?.alt).toBe(alt);
    expect(manager.serialize(reparsed)).toBe(markdown);
  });

  it("keeps a linked image with escaped alt text", () => {
    const document = {
      type: "doc",
      content: [
        {
          type: "image",
          attrs: { src: "image.png", alt: "a`b\\c" },
          marks: [{ type: "link", attrs: { href: "guide.md" } }],
        },
      ],
    };
    const markdown = manager.serialize(document);
    const reparsed = manager.parse(markdown);
    const image = reparsed.content?.[0]?.content?.[0];

    expect(image?.type).toBe("image");
    expect(image?.attrs?.alt).toBe("a`b\\c");
    expect(image?.marks?.[0]?.attrs?.href).toBe("guide.md");
    expect(manager.serialize(reparsed)).toBe(markdown);
  });
});
