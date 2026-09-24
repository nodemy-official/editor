import { getSchema } from "@tiptap/core";
import { DOMSerializer } from "@tiptap/pm/model";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

import {
  createMarkdownEditorExtensions,
  isSafeMarkdownLink,
} from "./markdown-editor-extensions";

describe("isSafeMarkdownLink", () => {
  it("allows http, https, mailto and tel URLs", () => {
    expect(isSafeMarkdownLink("https://example.com/x")).toBeTruthy();
    expect(isSafeMarkdownLink("http://example.com")).toBeTruthy();
    expect(isSafeMarkdownLink("mailto:a@b.c")).toBeTruthy();
    expect(isSafeMarkdownLink("tel:+12025550123")).toBeTruthy();
    expect(isSafeMarkdownLink("https://example.com/a b")).toBeTruthy();
  });

  it("allows same-origin relative references", () => {
    for (const url of [
      "#frag",
      "/path/x",
      "./rel",
      "../rel",
      "/",
      "#",
      "?",
      "docs/guide.md",
      "image.png",
      "?page=2",
      "x€z",
      "docs/My Guide.md",
    ]) {
      expect(isSafeMarkdownLink(url)).toBeTruthy();
    }
  });

  it("rejects scriptable and unknown schemes", () => {
    for (const url of [
      "javascript:alert(1)",
      "JAVASCRIPT:alert(1)",
      "data:text/html,x",
      "vbscript:x",
      "file:///etc/passwd",
      "ftp://x",
    ]) {
      expect(isSafeMarkdownLink(url)).toBeFalsy();
    }
  });

  it("rejects protocol-relative and backslash-normalizing paths", () => {
    // `//x` is scheme-relative; `/\x` normalizes to `//x` under WHATWG URL
    // resolution, which lets a "same-origin" href escape the origin.
    for (const url of [
      "//evil.com",
      String.raw`/\evil.com/x`,
      String.raw`/\\evil.com`,
      String.raw`\\evil.com`,
      String.raw`\/evil.com`,
    ]) {
      expect(isSafeMarkdownLink(url)).toBeFalsy();
    }
    // Deeper backslashes stay inside the origin's path and remain safe.
    expect(isSafeMarkdownLink(String.raw`/a/\b`)).toBeTruthy();
  });

  it("rejects empty and control-bearing values", () => {
    for (const url of [
      "",
      "  ",
      "x\ty",
      "x\ny",
      "\nhttps://example.com",
      "x\u007fz",
    ]) {
      expect(isSafeMarkdownLink(url)).toBeFalsy();
    }
    expect(isSafeMarkdownLink(42)).toBeFalsy();
    expect(isSafeMarkdownLink(null)).toBeFalsy();
    expect(isSafeMarkdownLink(undefined)).toBeFalsy();
  });
});

describe("safe Markdown media HTML", () => {
  it("renders relative links and image sources as DOM attributes", () => {
    const schema = getSchema(createMarkdownEditorExtensions());
    const document = new JSDOM().window.document;
    const content = schema.nodeFromJSON({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Guide",
              marks: [{ type: "link", attrs: { href: "docs/My Guide.md" } }],
            },
            {
              type: "text",
              text: "Page",
              marks: [{ type: "link", attrs: { href: "?page=2" } }],
            },
            {
              type: "text",
              text: "Call",
              marks: [{ type: "link", attrs: { href: "tel:+12025550123" } }],
            },
            {
              type: "image",
              attrs: { src: "My image.png", alt: "Diagram" },
            },
          ],
        },
      ],
    });
    const root = document.createElement("div");
    root.append(
      DOMSerializer.fromSchema(schema).serializeFragment(content.content, {
        document,
      })
    );

    expect(root.querySelector('a[href="docs/My Guide.md"]')?.textContent).toBe(
      "Guide"
    );
    expect(root.querySelector('a[href="?page=2"]')?.textContent).toBe("Page");
    expect(root.querySelector('a[href="tel:+12025550123"]')?.textContent).toBe(
      "Call"
    );
    expect(root.querySelector("img")?.getAttribute("src")).toBe("My image.png");
  });

  it("omits unsafe relative-reference attributes from rendered DOM", () => {
    const schema = getSchema(createMarkdownEditorExtensions());
    const document = new JSDOM().window.document;
    const content = schema.nodeFromJSON({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Link",
              marks: [{ type: "link", attrs: { href: String.raw`/\evil.com` } }],
            },
            {
              type: "image",
              attrs: { src: "javascript:alert(1)", alt: "Unsafe script" },
            },
            {
              type: "image",
              attrs: { src: "tel:+12025550123", alt: "Unsafe phone" },
            },
            {
              type: "image",
              attrs: { src: "  mailto:a@example.com  ", alt: "Padded mail" },
            },
            {
              type: "image",
              attrs: { src: " TEL:+12025550123 ", alt: "Padded phone" },
            },
          ],
        },
      ],
    });
    const root = document.createElement("div");
    root.append(
      DOMSerializer.fromSchema(schema).serializeFragment(content.content, {
        document,
      })
    );

    expect(root.querySelector("a")?.hasAttribute("href")).toBe(false);
    const images = root.querySelectorAll("img");
    expect(images).toHaveLength(4);
    for (const image of images) {
      expect(image.hasAttribute("src")).toBe(false);
    }
  });
});

describe("createMarkdownEditorExtensions appearance options", () => {
  it("passes host appearance options to extensions and permits disabling decorations", () => {
    const extensions = createMarkdownEditorExtensions({
      codeHighlighting: false,
      emojiDecorations: { emojiClassName: "custom-emoji" },
      footnoteReference: {
        HTMLAttributes: { class: "custom-footnote" },
        renderLabel: (label) => `[${label}]`,
      },
      markdownReveal: { revealedClass: "custom-reveal" },
      tablePlaceholders: false,
    });
    const byName = (name: string) =>
      extensions.find((extension) => extension.name === name);

    expect(byName("codeHighlighting")).toBeUndefined();
    expect(byName("tablePlaceholders")).toBeUndefined();
    expect(byName("emojiDecorations")?.options.emojiClassName).toBe(
      "custom-emoji"
    );
    expect(byName("markdownReveal")?.options.revealedClass).toBe("custom-reveal");
    expect(byName("footnoteReference")?.options.HTMLAttributes.class).toBe(
      "custom-footnote"
    );
  });
});
