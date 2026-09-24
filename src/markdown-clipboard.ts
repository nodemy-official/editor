import { Extension, type JSONContent } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import type { Slice } from "@tiptap/pm/model";

function hasMarkdownStructure(value: {
  type?: string;
  marks?: readonly unknown[];
  content?: readonly unknown[];
}): boolean {
  if (value.type && !["doc", "paragraph", "text"].includes(value.type)) {
    return true;
  }
  if (value.marks?.length) return true;
  return (value.content ?? []).some((child) =>
    hasMarkdownStructure(child as Parameters<typeof hasMarkdownStructure>[0])
  );
}

function isMarkdownPaste(text: string, parse: (value: string) => unknown) {
  // Let ordinary prose, including prose with punctuation, use the browser's
  // normal plain-text paste behavior. Only parsed Markdown structure opts in.
  try {
    const parsed = parse(text);
    return parsed !== null && typeof parsed === "object" &&
      hasMarkdownStructure(parsed as Parameters<typeof hasMarkdownStructure>[0]);
  } catch {
    return false;
  }
}

function inlineReferences(node: JSONContent): JSONContent {
  return {
    ...node,
    ...(node.marks
      ? {
          marks: node.marks.map((mark) =>
            mark.type === "link" && mark.attrs?.markdownReference
              ? {
                  ...mark,
                  attrs: { ...mark.attrs, markdownReference: null },
                }
              : mark
          ),
        }
      : {}),
    ...(node.content
      ? { content: node.content.map(inlineReferences) }
      : {}),
  };
}

/** Copy selected rich content as Markdown and parse plain Markdown on paste. */
export const MarkdownClipboard = Extension.create({
  name: "markdownClipboard",
  priority: 1000,
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        props: {
          clipboardTextSerializer(slice: Slice) {
            if (!editor.markdown) {
              return slice.content.textBetween(0, slice.content.size, "\n\n");
            }
            if (
              slice.content.childCount === 1 &&
              slice.content.firstChild?.attrs.markdownSource
            ) {
              return slice.content.textBetween(0, slice.content.size, "\n\n");
            }
            return editor.markdown.serialize({
              type: "doc",
              // A selection can omit the reference definition elsewhere in
              // the document. Copy its link with its own URL instead.
              content: slice.content.toJSON().map(inlineReferences),
            });
          },
          handlePaste(view, event) {
            const clipboard = event.clipboardData;
            const markdown = clipboard?.getData("text/markdown");
            const text = markdown || clipboard?.getData("text/plain");
            if (
              !editor.isEditable ||
              !editor.markdown ||
              !text ||
              view.state.selection.$head.parent.attrs.markdownSource ||
              view.state.selection.$head.parent.type.spec.code ||
              view.state.selection.$head.marks().some((mark) => mark.type.name === "code") ||
              (!markdown && clipboard?.types.includes("text/html"))
            ) {
              return false;
            }
            if (!markdown && !isMarkdownPaste(text, editor.markdown.parse.bind(editor.markdown))) {
              return false;
            }
            return editor.commands.insertContent(text, { contentType: "markdown" });
          },
        },
      }),
    ];
  },
});
