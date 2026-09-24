import type { JSONContent } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import { describe, expect, it } from "vitest";

import {
  createMarkdownEditorExtensions,
  type MarkdownEditorExtensionsOptions,
} from "./markdown-editor-extensions";

type ExtendedSyntax = MarkdownEditorExtensionsOptions["extendedSyntax"];

function createManager(extendedSyntax?: ExtendedSyntax) {
  const extensions = createMarkdownEditorExtensions(
    extendedSyntax === undefined ? {} : { extendedSyntax }
  );
  const markdown = extensions.find((extension) => extension.name === "markdown");
  return new MarkdownManager({
    extensions,
    marked: markdown?.options.marked,
    markedOptions: markdown?.options.markedOptions,
  });
}

function descendants(node: JSONContent): JSONContent[] {
  return [node, ...(node.content ?? []).flatMap(descendants)];
}

function nodeTypes(document: JSONContent) {
  return descendants(document).map((node) => node.type);
}

function markTypes(document: JSONContent) {
  return descendants(document).flatMap((node) =>
    (node.marks ?? []).map((mark) => mark.type)
  );
}

function linkHrefs(document: JSONContent) {
  return descendants(document).flatMap((node) =>
    (node.marks ?? [])
      .filter((mark) => mark.type === "link")
      .map((mark) => mark.attrs?.href)
  );
}

function extensionNames(extendedSyntax?: ExtendedSyntax) {
  return createMarkdownEditorExtensions(
    extendedSyntax === undefined ? {} : { extendedSyntax }
  ).map((extension) => extension.name);
}

describe("extended Markdown syntax options", () => {
  it("keeps GFM, footnotes, and emoji shortcodes enabled by default", () => {
    const manager = createManager();
    const markdown = [
      "| Head |",
      "| --- |",
      "| Cell |",
      "",
      "- [x] done",
      "",
      "~~removed~~",
      "",
      "https://example.com",
      "",
      "note[^n]",
      "",
      "[^n]: footnote",
      "",
      ":smile:",
    ].join("\n");
    const parsed = manager.parse(markdown);
    const types = nodeTypes(parsed);
    const marks = markTypes(parsed);
    const serialized = manager.serialize(parsed);

    expect(types).toContain("table");
    expect(types).toContain("taskItem");
    expect(types).toContain("footnoteReference");
    expect(types).toContain("footnoteDefinition");
    expect(marks).toContain("strike");
    expect(marks).toContain("link");
    expect(extensionNames()).toContain("emojiDecorations");
    expect(serialized).toContain(":smile:");
    expect(nodeTypes(manager.parse(serialized))).toContain("footnoteDefinition");
  });

  it("disables every extended syntax group with false and retains CommonMark", () => {
    const manager = createManager(false);
    const markdown = [
      "# Heading",
      "",
      "**bold** and *italic* [link](https://example.com) and `code`.",
      "",
      "| Head |",
      "| --- |",
      "| Cell |",
      "",
      "- [x] task",
      "",
      "~~strike~~ https://bare.example",
      "",
      "note[^n]",
      "",
      "[^n]: footnote",
      "",
      ":smile:",
      "",
      "```ts",
      "const value = 1",
      "```",
    ].join("\n");
    const parsed = manager.parse(markdown);
    const types = nodeTypes(parsed);
    const marks = markTypes(parsed);
    const hrefs = linkHrefs(parsed);
    const names = extensionNames(false);

    expect(types).toContain("heading");
    expect(types).toContain("codeBlock");
    expect(marks).toEqual(expect.arrayContaining(["bold", "italic", "link", "code"]));
    expect(hrefs).toContain("https://example.com");
    expect(hrefs).not.toContain("https://bare.example");
    expect(types).not.toEqual(expect.arrayContaining([
      "table",
      "taskItem",
      "footnoteReference",
      "footnoteDefinition",
    ]));
    expect(marks).not.toContain("strike");
    expect(names).not.toContain("table");
    expect(names).not.toContain("taskItem");
    expect(names).not.toContain("footnoteReference");
    expect(names).not.toContain("footnoteDefinition");
    expect(names).not.toContain("emojiDecorations");
    const serialized = manager.serialize(parsed);
    expect(serialized).toContain("| Head |");
    expect(serialized).toContain("| Cell |");
    expect(serialized).toContain("\\[x\\] task");
    expect(serialized).toContain("\\~\\~strike\\~\\~");
    expect(serialized).toContain(":smile:");
    expect(serialized).toContain("```ts");
  });

  it("can disable GFM while keeping footnotes and emoji shortcodes", () => {
    const manager = createManager({ gfm: false });
    const parsed = manager.parse(
      "| Head |\n| --- |\n| Cell |\n\n- [x] task\n\n~~strike~~ https://bare.example\n\nnote[^n]\n\n[^n]: footnote"
    );
    const types = nodeTypes(parsed);
    const marks = markTypes(parsed);

    expect(types).not.toEqual(expect.arrayContaining(["table", "taskItem"]));
    expect(marks).not.toContain("strike");
    expect(linkHrefs(parsed)).not.toContain("https://bare.example");
    expect(types).toContain("footnoteReference");
    expect(types).toContain("footnoteDefinition");
    expect(extensionNames({ gfm: false })).toContain("emojiDecorations");
  });

  it("can disable footnotes and emoji shortcodes independently", () => {
    const footnotesOff = createManager({ footnotes: false });
    const withoutFootnotes = footnotesOff.parse(
      "~~strike~~\n\ntext[^n]\n\n[^n]: footnote"
    );
    expect(markTypes(withoutFootnotes)).toContain("strike");
    expect(nodeTypes(withoutFootnotes)).not.toEqual(
      expect.arrayContaining(["footnoteReference", "footnoteDefinition"])
    );

    const emojiOff = createManager({ emojiShortcodes: false });
    const withEmojiText = emojiOff.parse(":smile: ~~strike~~");
    expect(extensionNames({ emojiShortcodes: false })).not.toContain(
      "emojiDecorations"
    );
    expect(markTypes(withEmojiText)).toContain("strike");
    expect(emojiOff.serialize(withEmojiText)).toContain(":smile:");
  });

  it("keeps parser settings independent between editor instances", () => {
    const enabled = createManager();
    const disabled = createManager(false);
    const table = "| Head |\n| --- |\n| Cell |";

    expect(nodeTypes(enabled.parse(table))).toContain("table");
    expect(nodeTypes(disabled.parse(table))).not.toContain("table");
    expect(nodeTypes(enabled.parse(table))).toContain("table");
  });
});
