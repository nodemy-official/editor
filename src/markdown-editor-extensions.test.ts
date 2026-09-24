import { describe, expect, it } from "vitest";

import {
  createMarkdownEditorExtensions,
  isSafeMarkdownLink,
} from "./markdown-editor-extensions";

describe("isSafeMarkdownLink", () => {
  it("allows http, https and mailto URLs", () => {
    expect(isSafeMarkdownLink("https://example.com/x")).toBeTruthy();
    expect(isSafeMarkdownLink("http://example.com")).toBeTruthy();
    expect(isSafeMarkdownLink("mailto:a@b.c")).toBeTruthy();
  });

  it("allows same-origin relative references", () => {
    for (const url of ["#frag", "/path/x", "./rel", "../rel", "/"]) {
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
    ]) {
      expect(isSafeMarkdownLink(url)).toBeFalsy();
    }
    // Deeper backslashes stay inside the origin's path and remain safe.
    expect(isSafeMarkdownLink(String.raw`/a/\b`)).toBeTruthy();
  });

  it("rejects empty, control-bearing and unparseable values", () => {
    for (const url of ["", "  ", "a b", "x\ty", "x\ny", "x€z"]) {
      expect(isSafeMarkdownLink(url)).toBeFalsy();
    }
    expect(isSafeMarkdownLink(42)).toBeFalsy();
    expect(isSafeMarkdownLink(null)).toBeFalsy();
    expect(isSafeMarkdownLink(undefined)).toBeFalsy();
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
