// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vitest";

import { createMarkdownEditorExtensions } from "./markdown-editor-extensions";

const editors: Editor[] = [];

afterEach(() => {
  for (const editor of editors) editor.destroy();
  editors.length = 0;
  document.body.replaceChildren();
});

describe("block math source editing", () => {
  it("reveals selected math as editable Markdown and saves the changed formula", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const editor = new Editor({
      element: host,
      extensions: createMarkdownEditorExtensions({ math: true }),
      contentType: "markdown",
      content: "$$\nx\n$$\n\n後文",
    });
    editors.push(editor);
    editor.view.focus();
    expect(editor.isFocused).toBe(true);

    editor.view.dispatch(
      editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 0))
    );
    const source = editor.state.doc.firstChild;
    if (!source) throw new Error("expected editable source");
    expect(source?.type.name).toBe("paragraph");
    expect(source?.attrs.markdownSource).toBe(true);
    expect(source?.textContent).toBe("$$\nx\n$$");

    const letter = source.textContent.indexOf("x");
    editor.view.dispatch(
      editor.state.tr.insertText("y", letter + 1, letter + 2)
    );
    const nextParagraph = editor.state.doc.firstChild!.nodeSize;
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, nextParagraph + 1)
      )
    );

    expect(editor.state.doc.firstChild?.type.name).toBe("blockMath");
    expect(editor.state.doc.firstChild?.attrs.latex).toBe("y");
    expect(editor.getMarkdown()).toBe("$$\ny\n$$\n\n後文");
  });

  it("opens block math by click while another paragraph source is active", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const editor = new Editor({
      element: host,
      extensions: createMarkdownEditorExtensions({ math: true }),
      contentType: "markdown",
      content: "前文\n\n$$\nx\n$$\n\n後文",
    });
    editors.push(editor);
    editor.view.focus();
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2))
    );
    expect(editor.state.doc.firstChild?.attrs.markdownSource).toBe(true);

    host.querySelector("[data-markdown-block-math]")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true })
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const activeSource = editor.state.doc.content.content.find(
      (node) => node.attrs.markdownSource && node.textContent.includes("$$")
    );
    expect(activeSource?.textContent).toBe("$$\nx\n$$");
  });
});
