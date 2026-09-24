import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { EditorView } from "@tiptap/pm/view";
import { nameToEmoji } from "gemoji";

export interface EmojiDecorationRenderContext {
  /** The editor view containing the emoji source. */
  view: EditorView;
  /** The document that owns the editor DOM. */
  document: Document;
  /** The Markdown short code, including colons. */
  source: string;
  /** The Gemoji name between the colons. */
  name: string;
  /** The resolved Unicode emoji. */
  emoji: string;
  /** The source range in the ProseMirror document. */
  from: number;
  to: number;
  /** Whether the editor selection currently overlaps the source. */
  editing: boolean;
  /** The configured class for the rendered emoji widget. */
  className: string;
}

export type EmojiSourceStyleContext = Pick<
  EmojiDecorationRenderContext,
  "source" | "name" | "emoji" | "from" | "to" | "editing"
>;

export interface EmojiDecorationsOptions {
  /** Class applied to the original Markdown source decoration. */
  sourceClassName: string;
  /** Inline style applied to the source; defaults to hiding it outside its selection. */
  sourceStyle:
    | string
    | ((context: EmojiSourceStyleContext) => string | undefined);
  /** Class used by the default emoji widget renderer. */
  emojiClassName: string;
  /** Create the rendered emoji widget. Return any DOM node supported by ProseMirror. */
  renderEmoji: (context: EmojiDecorationRenderContext) => Node;
}

/** Display Gemoji without changing source text, formatting, history or clipboard content. */
export const EmojiDecorations = Extension.create<EmojiDecorationsOptions>({
  addOptions() {
    return {
      sourceClassName: "",
      sourceStyle: ({ editing }) =>
        editing ? undefined : "display: none",
      emojiClassName: "",
      renderEmoji: ({ document, source, emoji, className }) => {
        const element = document.createElement("span");
        element.dataset.editorEmoji = source;
        if (className) {
          element.className = className;
        }
        element.textContent = emoji;
        return element;
      },
    };
  },
  name: "emojiDecorations",
  addProseMirrorPlugins() {
    const { editor } = this;
    const options = this.options;
    return [
      new Plugin({
        props: {
          decorations(state) {
            const decorations: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (
                node.type.spec.code ||
                node.attrs.markdownSource ||
                node.marks.some((mark) => mark.type.spec.code)
              ) {
                return false;
              }
              if (!node.isText || !node.text) {
                return;
              }
              for (const match of node.text.matchAll(/:(\+1|[-\w]+):/gu)) {
                const name = match[1];
                if (!Object.hasOwn(nameToEmoji, name)) {
                  continue;
                }
                const source = match[0];
                const from = pos + match.index;
                const to = from + source.length;
                const editing =
                  editor.isFocused &&
                  state.selection.from <= to &&
                  state.selection.to >= from;
                const styleContext: EmojiSourceStyleContext = {
                  source,
                  name,
                  emoji: nameToEmoji[name],
                  from,
                  to,
                  editing,
                };
                const sourceStyle =
                  typeof options.sourceStyle === "function"
                    ? options.sourceStyle(styleContext)
                    : options.sourceStyle;
                decorations.push(
                  Decoration.inline(from, to, {
                    "data-editor-emoji-source": source,
                    ...(options.sourceClassName
                      ? { class: options.sourceClassName }
                      : {}),
                    ...(sourceStyle === undefined ? {} : { style: sourceStyle }),
                  })
                );
                if (!editing) {
                  decorations.push(
                    Decoration.widget(
                      from,
                      (view) => {
                        const context: EmojiDecorationRenderContext = {
                          ...styleContext,
                          view,
                          document: view.dom.ownerDocument,
                          className: options.emojiClassName,
                        };
                        return options.renderEmoji(context);
                      },
                      // Widget keys must be unique within the set; identical
                      // emoji at different positions otherwise collide.
                      {
                        key: `${source}-${from}`,
                        marks: node.marks,
                        side: -1,
                      }
                    )
                  );
                }
              }
            });
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});
