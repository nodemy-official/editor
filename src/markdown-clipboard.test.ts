// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { Slice } from "@tiptap/pm/model";
import { afterEach, describe, expect, it } from "vitest";

import { createMarkdownEditorExtensions } from "./markdown-editor-extensions";

const editors: Editor[] = [];

afterEach(() => {
  for (const editor of editors) editor.destroy();
  editors.length = 0;
  document.body.replaceChildren();
});

function createEditor(content: string) {
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({
    element,
    extensions: createMarkdownEditorExtensions(),
    contentType: "markdown",
    content,
  });
  editors.push(editor);
  return editor;
}

function paste(editor: Editor, text: string, html = "") {
  const event = new Event("paste") as ClipboardEvent;
  Object.defineProperty(event, "clipboardData", {
    value: {
      types: html ? ["text/plain", "text/html"] : ["text/plain"],
      getData: (type: string) =>
        type === "text/plain" ? text : type === "text/html" ? html : "",
    },
  });
  return editor.view.someProp("handlePaste", (handler) =>
    handler(editor.view, event, Slice.empty)
  );
}

describe("MarkdownClipboard", () => {
  it("copies a selected formatted range as Markdown", () => {
    const editor = createEditor("Hello **world**!");
    const slice = editor.state.doc.slice(7, 12);
    const copied = editor.view.someProp("clipboardTextSerializer", (serialize) =>
      serialize(slice, editor.view)
    );
    expect(copied).toBe("**world**");
  });

  it("copies a selected reference link with its destination", () => {
    const editor = createEditor("[guide][docs]\n\n[docs]: /guide");
    const slice = editor.state.doc.slice(1, 6);
    const copied = editor.view.someProp("clipboardTextSerializer", (serialize) =>
      serialize(slice, editor.view)
    );
    expect(copied).toBe("[guide](/guide)");
  });

  it("pastes plain Markdown into rendered content as editable structure", () => {
    const editor = createEditor("Before");
    editor.commands.setTextSelection(editor.state.doc.content.size);

    expect(paste(editor, "\n\n## Heading\n\n**bold**")).toBe(true);
    expect(editor.getMarkdown()).toContain("## Heading");
    expect(editor.getJSON().content?.some((node) => node.type === "heading")).toBe(true);
    expect(editor.getJSON().content?.some((node) =>
      node.content?.some((child) => child.marks?.some((mark) => mark.type === "bold"))
    )).toBe(true);
  });

  it("pastes reference links together with their definitions", () => {
    const editor = createEditor("");
    expect(paste(editor, "[guide][docs]\n\n[docs]: /guide")).toBe(true);
    expect(editor.getMarkdown()).toContain("[guide][docs]");
    expect(editor.getMarkdown()).toContain("[docs]: /guide");
  });

  it("leaves ordinary prose and HTML clipboard content to native paste", () => {
    const editor = createEditor("Before");
    expect(paste(editor, "Ordinary text with * punctuation")).toBeUndefined();
    expect(paste(editor, "**bold**", "<strong>bold</strong>")).toBeUndefined();
    expect(editor.getMarkdown()).toBe("Before");
  });

  it("does not parse Markdown inside a code block", () => {
    const editor = createEditor("```text\ncode\n```");
    editor.commands.setTextSelection(3);
    expect(paste(editor, "**literal**")).toBeUndefined();
  });
});
