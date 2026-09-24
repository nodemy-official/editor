import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { EditorView } from "@tiptap/pm/view";

export interface TablePlaceholderRenderContext {
  /** The editor view containing the empty cell. */
  view: EditorView;
  /** The document that owns the editor DOM. */
  document: Document;
  /** The empty table header or cell node. */
  cell: ProseMirrorNode;
  /** The cell's position in the ProseMirror document. */
  position: number;
  /** The default placeholder text, if the renderer wants to use it. */
  text: string;
  /** The default placeholder class, if the renderer wants to use it. */
  className: string;
}

export interface TablePlaceholdersOptions {
  /** Class applied to the empty cell node decoration. */
  emptyCellClassName: string;
  /** Class used by the default placeholder renderer. */
  placeholderClassName: string;
  /** Text used by the default placeholder renderer. */
  placeholderText: string;
  /** Create the placeholder widget. Return any DOM node supported by ProseMirror. */
  renderPlaceholder: (context: TablePlaceholderRenderContext) => Node;
}

export const TablePlaceholders = Extension.create<TablePlaceholdersOptions>({
  addOptions() {
    return {
      emptyCellClassName: "editor__empty-table-cell",
      placeholderClassName: "editor__table-placeholder",
      placeholderText: "…",
      renderPlaceholder: ({ document, className, text }) => {
        const hint = document.createElement("span");
        hint.className = className;
        hint.contentEditable = "false";
        hint.textContent = text;
        return hint;
      },
    };
  },
  addProseMirrorPlugins() {
    const options = this.options;
    return [
      new Plugin({
        props: {
          decorations: ({ doc }) => {
            if (!this.editor.isEditable) {
              return null;
            }
            const decorations: Decoration[] = [];
            doc.descendants((node, pos) => {
              if (
                node.type.name !== "tableHeader" &&
                node.type.name !== "tableCell"
              ) {
                return true;
              }
              const paragraph = node.firstChild;
              if (
                node.childCount === 1 &&
                paragraph?.type.name === "paragraph" &&
                paragraph.content.size === 0
              ) {
                // A widget is visible to assistive technology without entering the saved document.
                decorations.push(
                  Decoration.node(pos + 1, pos + node.nodeSize - 1, {
                    class: options.emptyCellClassName,
                  }),
                  Decoration.widget(
                    pos + 2,
                    (view) =>
                      options.renderPlaceholder({
                        view,
                        document: view.dom.ownerDocument,
                        cell: node,
                        position: pos,
                        text: options.placeholderText,
                        className: options.placeholderClassName,
                      }),
                    {
                      side: -1,
                      // Widget keys must be unique within the set; identical
                      // placeholders in different cells collide otherwise.
                      key: `table-placeholder-${pos}`,
                      ignoreSelection: true,
                    }
                  )
                );
              }
              return false;
            });
            return DecorationSet.create(doc, decorations);
          },
        },
      }),
    ];
  },
  name: "tablePlaceholders",
});
