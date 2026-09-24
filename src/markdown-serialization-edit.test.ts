// @vitest-environment jsdom
import { Editor, type JSONContent } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import { NodeSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vitest";

import { createMarkdownEditorExtensions } from "./markdown-editor-extensions";

const editors: Editor[] = [];

afterEach(() => {
  for (const editor of editors) editor.destroy();
  editors.length = 0;
  document.body.replaceChildren();
});

function createEditor(content: string, math = false) {
  const host = document.createElement("div");
  document.body.append(host);
  const editor = new Editor({
    element: host,
    extensions: createMarkdownEditorExtensions({ math }),
    contentType: "markdown",
    content,
  });
  editors.push(editor);
  return editor;
}

function descendants(node: JSONContent): JSONContent[] {
  return [node, ...(node.content ?? []).flatMap(descendants)];
}

describe("editor Markdown serialization boundaries", () => {
  it("keeps literal dollar text literal across plain, linked, and bold text", () => {
    const source = String.raw`literal \$x$ and [linked \$y$](https://example.com) and **bold \$z$**`;
    const editor = createEditor(source, true);
    const before = editor.getJSON();

    expect(descendants(before).some((node) => node.type === "inlineMath")).toBe(
      false
    );

    const markdown = editor.getMarkdown();
    expect(markdown).toContain(String.raw`literal \$x\$`);
    expect(markdown).toContain(String.raw`[linked \$y\$](https://example.com)`);
    expect(markdown).toContain(String.raw`**bold \$z\$**`);
    expect(editor.getJSON()).toStrictEqual(before);

    const reparsed = editor.markdown?.parse(markdown);
    expect(reparsed).toBeDefined();
    expect(
      descendants(reparsed!).some((node) => node.type === "inlineMath")
    ).toBe(false);
    const linkedText = descendants(reparsed!).find(
      (node) =>
        node.type === "text" &&
        node.text?.includes("$y$") &&
        node.marks?.some((mark) => mark.type === "link")
    );
    expect(linkedText).toBeDefined();
    const boldText = descendants(reparsed!).find(
      (node) =>
        node.type === "text" &&
        node.text?.includes("$z$") &&
        node.marks?.some((mark) => mark.type === "bold")
    );
    expect(boldText).toBeDefined();
  });

  it("keeps explicit math and code spans unchanged", () => {
    const editor = createEditor("formula $x$ and `$y$`", true);
    const markdown = editor.getMarkdown();

    expect(markdown).toContain("$x$");
    expect(markdown).toContain("`$y$`");

    const reparsed = editor.markdown?.parse(markdown);
    expect(descendants(reparsed!).some((node) => node.type === "inlineMath")).toBe(
      true
    );
    const codeText = descendants(reparsed!).find(
      (node) => node.type === "text" && node.text === "$y$"
    );
    expect(codeText?.marks?.some((mark) => mark.type === "code")).toBe(true);
  });

  it("keeps block-looking paragraph text as paragraph text", () => {
    const source = String.raw`\# heading

\- item

\+ item

\* item

1\. ordered item

2\) ordered item

\---

before
\---`;
    const editor = createEditor(source);
    const original = editor.getJSON() as JSONContent;
    const markdown = editor.getMarkdown();

    expect(markdown).toContain(String.raw`\# heading`);
    expect(markdown).toContain(String.raw`\- item`);
    expect(markdown).toContain(String.raw`\+ item`);
    expect(markdown).toContain(String.raw`\* item`);
    expect(markdown).toContain(String.raw`1\. ordered item`);
    expect(markdown).toContain(String.raw`2\) ordered item`);
    expect(markdown).toContain(String.raw`\---`);

    const reparsed = editor.markdown?.parse(markdown);
    expect(reparsed?.content?.map((node) => node.type)).toEqual(
      original.content?.map((node) => node.type)
    );
    expect(reparsed?.content?.every((node) => node.type === "paragraph")).toBe(
      true
    );
    expect(reparsed?.content?.map((node) => node.content?.[0]?.text)).toEqual(
      original.content?.map((node) => node.content?.[0]?.text)
    );
  });

  it("still serializes actual headings, lists, and horizontal rules", () => {
    const editor = createEditor("# Heading\n\n- item\n\n---");
    const markdown = editor.getMarkdown();

    expect(markdown).toContain("# Heading");
    expect(markdown).toContain("- item");
    expect(markdown).toContain("---");
  });

  it("keeps an escaped setext underline inside a paragraph", () => {
    const editor = createEditor(String.raw`text
\===`);
    const markdown = editor.getMarkdown();

    expect(markdown).toContain(String.raw`\===`);
    expect(editor.markdown?.parse(markdown).content?.[0]?.type).toBe(
      "paragraph"
    );
  });

  it("leaves active Markdown source and code content untouched", () => {
    const editor = createEditor("$$\nx\n$$\n\n後文", true);
    const formula = editor.state.doc.firstChild;
    expect(formula?.type.name).toBe("blockMath");

    editor.view.focus();
    expect(editor.isFocused).toBe(true);
    editor.view.dispatch(
      editor.state.tr.setSelection(
        NodeSelection.create(editor.state.doc, 0)
      )
    );
    expect(editor.state.doc.firstChild?.attrs.markdownSource).toBe(true);
    expect(editor.getMarkdown()).toBe("$$\nx\n$$\n\n後文");

    const code = createEditor("```text\n$x$\n```", true);
    expect(code.getMarkdown()).toContain("```text\n$x$\n```");
  });
});

describe("MarkdownManager serialization boundaries", () => {
  it("keeps dollar and block-looking prose literal without mutating input", () => {
    const manager = new MarkdownManager({
      extensions: createMarkdownEditorExtensions({ math: true }),
    });
    const source = String.raw`literal \$x$ and [linked \$y$](https://example.com) and **bold \$z$**

\# heading

\- item

\* item

1\. ordered item

\---`;
    const original = manager.parse(source);
    const before = structuredClone(original);
    const markdown = manager.serialize(original);

    expect(markdown).toContain(String.raw`literal \$x\$`);
    expect(markdown).toContain(
      String.raw`[linked \$y\$](https://example.com)`
    );
    expect(markdown).toContain(String.raw`**bold \$z\$**`);
    expect(markdown).toContain(String.raw`\# heading`);
    expect(markdown).toContain(String.raw`\- item`);
    expect(markdown).toContain(String.raw`\* item`);
    expect(markdown).toContain(String.raw`1\. ordered item`);
    expect(markdown).toContain(String.raw`\---`);
    expect(original).toStrictEqual(before);

    const reparsed = manager.parse(markdown);
    expect(descendants(reparsed).some((node) => node.type === "inlineMath")).toBe(
      false
    );
    expect(reparsed.content?.every((node) => node.type === "paragraph")).toBe(
      true
    );
  });
});
