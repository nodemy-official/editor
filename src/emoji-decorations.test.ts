// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";

import { EmojiDecorations } from "./emoji-decorations";

const editors: Editor[] = [];

afterEach(() => {
  for (const editor of editors) {
    editor.destroy();
  }
  editors.length = 0;
  document.body.replaceChildren();
});

function createEditor(content: string | object) {
  const host = document.createElement("div");
  document.body.append(host);
  const editor = new Editor({
    element: host,
    extensions: [StarterKit, EmojiDecorations],
    content,
  });
  editors.push(editor);
  return { editor, host };
}

describe("emoji decorations across text nodes", () => {
  it("renders a shortcode split by formatting and shows its source while editing", () => {
    const { editor, host } = createEditor(":smile:");
    editor.commands.setTextSelection({ from: 2, to: 4 });
    editor.commands.toggleBold();

    expect(editor.state.doc.textContent).toBe(":smile:");
    expect(editor.state.doc.firstChild?.childCount).toBe(3);
    expect(
      editor.state.doc.firstChild?.child(1).marks.map((mark) => mark.type.name)
    ).toContain("bold");
    expect(host.querySelector("[data-editor-emoji]")?.textContent).toBe("😄");

    const documentBeforeFocus = editor.getJSON();
    editor.view.focus();
    editor.commands.setTextSelection({ from: 2, to: 4 });

    expect(host.querySelector("[data-editor-emoji]")).toBeNull();
    expect(host.textContent).toContain(":smile:");
    expect(host.textContent).not.toContain("😄");
    expect(
      Array.from(
        host.querySelectorAll<HTMLElement>("[data-editor-emoji-source]")
      )
        .some((source) => source.style.display === "none")
    ).toBe(false);
    expect(editor.getJSON()).toEqual(documentBeforeFocus);
  });

  it("does not join a shortcode across inline code", () => {
    const { host } = createEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: ":sm" },
            { type: "text", text: "i", marks: [{ type: "code" }] },
            { type: "text", text: "le:" },
          ],
        },
      ],
    });

    expect(host.querySelector("[data-editor-emoji]")).toBeNull();
    expect(host.textContent).toBe(":smile:");
  });
});
