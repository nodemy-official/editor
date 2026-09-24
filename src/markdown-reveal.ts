import { Extension, Node, getExtensionField, getMarkRange } from "@tiptap/core";
import type {
  AnyExtension,
  Editor,
  JSONContent,
  NodeConfig,
} from "@tiptap/core";
import { Fragment, Slice } from "@tiptap/pm/model";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import {
  EditorState,
  NodeSelection,
  Plugin,
  PluginKey,
  TextSelection,
} from "@tiptap/pm/state";
import type { Selection, Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { EditorView } from "@tiptap/pm/view";

import { inlineCodeSpans, mapOutsideCodeSpans } from "./markdown-code-span";

interface ActiveSource {
  pos: number;
  original: ProseMirrorNode;
  source: string;
  inline?: boolean;
}
interface RevealState {
  active: ActiveSource | null;
  suspended: boolean;
  dismissedAt: number | null;
}
type RevealMeta = Partial<RevealState> & { internal?: boolean };
const revealKey = new PluginKey<RevealState>("markdownReveal");
const richSelections = new WeakMap<EditorState, EditorState>();

// Serialize marked inline nodes in their own run. The upstream serializer
// reopens the previous text marks after a marked non-text node, even when
// that node ends the paragraph. Isolating it avoids dangling delimiters while
// retaining the marks that the node's own renderer writes.
const MarkdownMarkedInline = Extension.create({
  name: "markdownMarkedInline",
  renderMarkdown(node, helpers) {
    return helpers.renderChildren([node.attrs?.original as JSONContent]);
  },
});

function isolateInlineMarks(content: JSONContent[] | undefined) {
  return content?.map((node) =>
    node.type !== "text" && node.marks?.length
      ? { type: "markdownMarkedInline", attrs: { original: node } }
      : node
  );
}

/** An editable source span keeps the surrounding inline content rendered. */
interface MarkdownSourceOptions {
  className?: string;
}

const MarkdownSource = Node.create<MarkdownSourceOptions>({
  name: "markdownSource",
  addOptions: () => ({ className: undefined }),
  inline: true,
  group: "inline",
  content: "text*",
  marks: "",
  code: true,
  selectable: false,
  whitespace: "pre",
  addAttributes: () => ({ markdownSource: { default: true, rendered: false } }),
  parseHTML: () => [{ tag: "span[data-markdown-source]" }],
  renderHTML() {
    return [
      "span",
      {
        "data-markdown-source": "true",
        ...(this.options.className ? { class: this.options.className } : {}),
      },
      0,
    ];
  },
  renderMarkdown: (node) =>
    node.content?.map((child) => child.text ?? "").join("") ?? "",
});

function inlineTarget(editor: Editor, selection: Selection) {
  const { $head } = selection;
  if (
    !selection.empty &&
    !(selection instanceof NodeSelection && selection.node.isInline)
  ) {
    return;
  }
  if ($head.parent.isInline || selection instanceof NodeSelection) {
    const from =
      selection instanceof NodeSelection ? selection.from : $head.before();
    const to =
      selection instanceof NodeSelection ? selection.to : $head.after();
    return {
      from,
      to,
      original: editor.schema.nodes.paragraph.create(
        null,
        $head.doc.slice(from, to).content
      ),
    };
  }
  if (!$head.parent.isTextblock) {
    return;
  }
  const child = $head.nodeAfter ?? $head.nodeBefore;
  const ranges =
    child?.marks.flatMap((mark) => {
      const range = getMarkRange($head, mark.type, mark.attrs);
      return range ? [range] : [];
    }) ?? [];
  if (!ranges.length) {
    return;
  }
  const from = Math.min(...ranges.map((range) => range.from));
  const to = Math.max(...ranges.map((range) => range.to));
  return {
    from,
    to,
    original: editor.schema.nodes.paragraph.create(
      null,
      selection.$head.doc.slice(from, to).content
    ),
  };
}

/** Keep source text editable in the same contenteditable, without escaping its delimiters. */
export function withMarkdownReveal(
  extension: AnyExtension,
  footnotes = true
): AnyExtension {
  if (
    !(extension instanceof Node) ||
    !["paragraph", "heading"].includes(extension.name)
  ) {
    return extension;
  }
  const renderMarkdown = getExtensionField<NodeConfig["renderMarkdown"]>(
    extension,
    "renderMarkdown"
  );
  return extension.extend({
    addAttributes() {
      return {
        ...this.parent?.(),
        markdownSource: { default: false, rendered: false },
      };
    },
    renderMarkdown(node, helpers, context) {
      if (node.attrs?.markdownSource) {
        return node.content?.map((child) => child.text ?? "").join("") ?? "";
      }
      const rendered =
        renderMarkdown?.(
          {
            ...node,
            content: isolateInlineMarks(inlineCodeSpans(node.content)),
          },
          helpers,
          context
        ) ?? "";
      // A `[^label]:` at a line start reparses as a footnote definition, so a
      // footnote reference followed by a colon needs the colon escaped. Line
      // starts inside code spans stay literal; escaping there would write a
      // stray backslash into the span's content.
      return footnotes
        ? mapOutsideCodeSpans(rendered, (chunk) =>
            chunk.replaceAll(/(^|\n)(\[\^[^\]\n]+)\]:/gu, String.raw`$1$2]\:`)
          )
        : rendered;
    },
    whitespace: "pre",
  });
}

function serialize(editor: Editor, node: ProseMirrorNode) {
  if (!editor.markdown) {
    throw new Error("Markdown reveal requires the Markdown extension");
  }
  return editor.markdown.serialize(node.toJSON() as JSONContent);
}

/** Ask the serializer where a document position falls among the Markdown delimiters. */
function sourceOffset(editor: Editor, node: ProseMirrorNode, offset: number) {
  let marker = "\uE000";
  while (node.textContent.includes(marker)) {
    marker += "\uE000";
  }
  const marked = node.replace(
    offset,
    offset,
    new Slice(
      Fragment.from(
        node.type.schema.text(marker, node.resolve(offset).marks())
      ),
      0,
      0
    )
  );
  return serialize(editor, marked).indexOf(marker);
}

function documentOffset(editor: Editor, node: ProseMirrorNode, offset: number) {
  const positions: number[] = [];
  for (let pos = 0; pos <= node.content.size; pos += 1) {
    if (node.resolve(pos).parent.inlineContent) {
      positions.push(pos);
    }
  }
  let low = 0;
  let high = positions.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (sourceOffset(editor, node, positions[middle]) < offset) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return positions[low] ?? 0;
}

function revealAtDomSelection(view: EditorView) {
  const tr = view.state.tr
    .setMeta("addToHistory", false)
    .setMeta(revealKey, { dismissedAt: null });
  const selection = view.dom.ownerDocument.getSelection();
  if (
    selection?.anchorNode &&
    selection.focusNode &&
    view.dom.contains(selection.anchorNode) &&
    view.dom.contains(selection.focusNode)
  ) {
    try {
      tr.setSelection(
        TextSelection.between(
          tr.doc.resolve(
            view.posAtDOM(selection.anchorNode, selection.anchorOffset)
          ),
          tr.doc.resolve(
            view.posAtDOM(selection.focusNode, selection.focusOffset)
          )
        )
      );
    } catch {
      // A selection inside widget or decoration DOM may not map to a document
      // position; keep the current ProseMirror selection instead.
    }
  }
  view.dispatch(tr);
}

function restore(editor: Editor, tr: Transaction, active: ActiveSource) {
  const node = tr.doc.nodeAt(active.pos);
  if (!node?.attrs.markdownSource || !editor.markdown) {
    return;
  }
  const source = node.textContent;
  const content =
    source === active.source
      ? active.inline
        ? active.original.content
        : Fragment.from(active.original)
      : editor.schema.nodeFromJSON(editor.markdown.parse(source)).content;
  if (active.inline) {
    const replacement =
      source === active.source
        ? content
        : content.childCount === 1 &&
            content.firstChild?.type.name === "paragraph"
          ? content.firstChild.content
          : source
            ? Fragment.from(editor.schema.text(source))
            : Fragment.empty;
    const { anchor, head } = tr.selection;
    const mappingStart = tr.mapping.maps.length;
    tr.replaceWith(active.pos, active.pos + node.nodeSize, replacement);
    const wrapper = editor.schema.nodes.paragraph.create(null, replacement);
    const map = (pos: number) =>
      pos > active.pos && pos < active.pos + node.nodeSize
        ? active.pos + documentOffset(editor, wrapper, pos - active.pos - 1)
        : tr.mapping.slice(mappingStart).map(pos);
    tr.setSelection(
      TextSelection.between(
        tr.doc.resolve(map(anchor)),
        tr.doc.resolve(map(head))
      )
    );
    return;
  }
  const replacement = content.size
    ? content
    : Fragment.from(editor.schema.nodes.paragraph.create());
  const { anchor, head } = tr.selection;
  const inside = (pos: number) =>
    pos > active.pos && pos < active.pos + node.nodeSize;
  const $pos = tr.doc.resolve(active.pos);
  // A list item's first child must remain a paragraph even when the source becomes a heading.
  const fitted = $pos.parent.canReplace(
    $pos.index(),
    $pos.index() + 1,
    replacement
  )
    ? replacement
    : Fragment.from(editor.schema.nodes.paragraph.create()).append(replacement);
  tr.replaceWith(active.pos, active.pos + node.nodeSize, fitted);
  const wrapper = editor.schema.nodes.doc.create(null, fitted);
  const map = (pos: number) =>
    inside(pos)
      ? active.pos + documentOffset(editor, wrapper, pos - active.pos - 1)
      : tr.mapping.map(pos);
  tr.setSelection(
    TextSelection.between(
      tr.doc.resolve(map(anchor)),
      tr.doc.resolve(map(head))
    )
  );
}

/** Inspect formatting at a source caret without changing the live document or its history. */
export function getMarkdownRevealState(editor: Editor) {
  const active = revealKey.getState(editor.state)?.active;
  if (!active) {
    return editor.state;
  }
  const cached = richSelections.get(editor.state);
  if (cached) {
    return cached;
  }
  const { tr } = editor.state;
  restore(editor, tr, active);
  const result = EditorState.create({
    doc: tr.doc,
    selection: tr.selection,
    storedMarks: tr.storedMarks,
  });
  richSelections.set(editor.state, result);
  return result;
}

/**
 * Whether the caret still sits inside the active source span. An inline
 * source treats both edges as outside once the caret itself navigates
 * there — the mark's end boundary never reveals, and reaching offset 0 or
 * the end by keyboard or click means the caret left the span. Editing
 * transactions legitimately leave the caret at the edge (typing,
 * select-all), so only pure selection moves trigger the exit; reveal
 * creation always lands the caret strictly inside.
 */
function caretInsideSource(
  selection: Selection,
  transactions: readonly Transaction[],
  inline = false
) {
  const { $head, $anchor } = selection;
  if (!$head.sameParent($anchor) || !$head.parent.attrs.markdownSource) {
    return false;
  }
  if (!inline) {
    return true;
  }
  const selectionMove =
    selection.empty &&
    transactions.every((tr) => !tr.docChanged) &&
    transactions.some((tr) => tr.selectionSet);
  return (
    !selectionMove ||
    ($head.parentOffset > 0 && $head.parentOffset < $head.parent.content.size)
  );
}

/** Formatting controls operate on parsed content and retain the corresponding selection. */
export function prepareMarkdownCommand(editor: Editor | null) {
  if (editor && revealKey.getState(editor.state)?.active) {
    editor.view.dispatch(
      editor.state.tr
        .setMeta(revealKey, { suspended: true })
        .setMeta("preventUpdate", true)
        .setMeta("addToHistory", false)
    );
  }
}

export interface MarkdownRevealOptions {
  /** Class attached to the active source node. An empty string omits it. */
  revealedClass: string;
  /** Optional class attached to the inline source span. */
  sourceClass?: string;
}

export const MarkdownReveal = Extension.create<MarkdownRevealOptions>({
  addOptions: () => ({
    revealedClass: "editor__revealed-markdown",
    sourceClass: undefined,
  }),
  addExtensions() {
    return [
      MarkdownSource.configure({ className: this.options.sourceClass }),
      MarkdownMarkedInline,
    ];
  },
  addProseMirrorPlugins() {
    const { editor } = this;
    const { revealedClass } = this.options;
    let selectingWithPointer = false;
    return [
      new Plugin<RevealState>({
        key: revealKey,
        state: {
          init: () => ({ active: null, suspended: false, dismissedAt: null }),
          apply(tr, previous) {
            const meta = tr.getMeta(revealKey) as RevealMeta | undefined;
            let active = previous.active
              ? {
                  ...previous.active,
                  // Associate right: text inserted exactly at the node
                  // boundary must not detach tracking and leave a stray
                  // source span frozen in the document.
                  pos: tr.mapping.map(previous.active.pos, 1),
                }
              : null;
            // External edits (setContent, collaboration, …) can drop the node;
            // a stale active would linger in plugin state forever.
            if (
              active &&
              tr.docChanged &&
              !tr.doc.nodeAt(active.pos)?.attrs.markdownSource
            ) {
              active = null;
            }
            return {
              active,
              dismissedAt:
                tr.docChanged ||
                (tr.selectionSet && tr.selection.head !== previous.dismissedAt)
                  ? null
                  : previous.dismissedAt,
              suspended:
                tr.getMeta("focus") || (tr.selectionSet && !tr.docChanged)
                  ? false
                  : previous.suspended,
              ...meta,
            };
          },
        },
        appendTransaction(transactions, _oldState, state) {
          if (
            selectingWithPointer ||
            transactions.some((tr) => tr.getMeta("focus")) ||
            transactions.every(
              (tr) =>
                (tr.getMeta(revealKey) as RevealMeta | undefined)?.internal
            )
          ) {
            return;
          }
          const reveal = revealKey.getState(state);
          if (!reveal) {
            return;
          }
          const enabled =
            editor.isFocused && editor.isEditable && !reveal.suspended;
          if (
            reveal.active &&
            enabled &&
            caretInsideSource(
              state.selection,
              transactions,
              reveal.active.inline === true
            )
          ) {
            return;
          }
          const { tr } = state;
          const selectedBlockMath =
            state.selection instanceof NodeSelection &&
            state.selection.node.type.name === "blockMath"
              ? state.selection.from
              : null;
          if (reveal.active) {
            restore(editor, tr, reveal.active);
          }
          if (selectedBlockMath !== null) {
            const pos = tr.mapping.map(selectedBlockMath, 1);
            if (tr.doc.nodeAt(pos)?.type.name === "blockMath") {
              tr.setSelection(NodeSelection.create(tr.doc, pos));
            }
          }
          let active: ActiveSource | null = null;
          const { selection } = tr;
          let { depth } = selection.$head;
          while (depth > 0 && !selection.$head.node(depth).isTextblock) {
            depth -= 1;
          }
          const parent = selection.$head.node(depth);
          const target =
            reveal.dismissedAt === selection.head
              ? undefined
              : inlineTarget(editor, selection);
          if (
            enabled &&
            selection instanceof NodeSelection &&
            selection.node.type.name === "blockMath" &&
            reveal.dismissedAt !== selection.head &&
            !(reveal.active?.original.type.name === "blockMath" &&
              reveal.active.pos === selection.from)
          ) {
            const { from, to, node } = selection;
            const source = serialize(editor, node);
            const firstLineEnd = source.indexOf("\n");
            active = { pos: from, original: node, source };
            tr.replaceWith(
              from,
              to,
              editor.schema.nodes.paragraph.create(
                { markdownSource: true },
                editor.schema.text(source)
              )
            );
            tr.setSelection(
              TextSelection.create(
                tr.doc,
                from + 1 + (firstLineEnd < 0 ? 0 : firstLineEnd + 1)
              )
            );
          } else if (
            enabled &&
            target &&
            !(reveal.active?.inline && target.from === reveal.active.pos)
          ) {
            const { from, to, original } = target;
            const source = serialize(editor, original);
            const offset = sourceOffset(
              editor,
              original,
              selection.head - from
            );
            active = { pos: from, original, source, inline: true };
            tr.replaceWith(
              from,
              to,
              editor.schema.nodes.markdownSource.create(
                null,
                editor.schema.text(source)
              )
            );
            tr.setSelection(
              TextSelection.create(tr.doc, from + 1 + Math.max(0, offset))
            );
          } else if (
            enabled &&
            selection.empty &&
            ["paragraph", "heading"].includes(parent.type.name) &&
            parent.content.content.every(
              (child) =>
                (child.isText && !child.marks.length) ||
                ["hardBreak", "footnoteReference"].includes(child.type.name)
            )
          ) {
            const pos = selection.$head.before(depth);
            const source = serialize(editor, parent);
            const offset = sourceOffset(
              editor,
              parent,
              selection.head - pos - 1
            );
            active = { pos, original: parent, source };
            tr.replaceWith(
              pos,
              pos + parent.nodeSize,
              parent.type.create(
                { ...parent.attrs, markdownSource: true },
                source ? editor.schema.text(source) : null
              )
            );
            tr.setSelection(
              TextSelection.create(tr.doc, pos + 1 + Math.max(0, offset))
            );
          }
          if (!tr.docChanged) {
            return;
          }
          return tr
            .setMeta(revealKey, {
              active,
              internal: true,
              // Keep a boundary caret outside the source until it moves or is clicked.
              dismissedAt:
                reveal.active && !active ? tr.selection.head : null,
            })
            .setMeta("addToHistory", false);
        },
        view(view) {
          let destroyed = false;
          const finishSelection = () => {
            if (!selectingWithPointer) {
              return;
            }
            // ProseMirror finishes its pointer selection on the document's mouseup.
            queueMicrotask(() => {
              selectingWithPointer = false;
              if (!destroyed) {
                revealAtDomSelection(view);
              }
            });
          };
          // A drag released outside the window never reaches the document's
          // mouseup; the window blur clears the flag so reveal keeps working.
          const cancelSelection = () => {
            selectingWithPointer = false;
          };
          const win = view.dom.ownerDocument.defaultView;
          view.dom.ownerDocument.addEventListener("mouseup", finishSelection);
          win?.addEventListener("blur", cancelSelection);
          return {
            destroy() {
              destroyed = true;
              view.dom.ownerDocument.removeEventListener(
                "mouseup",
                finishSelection
              );
              win?.removeEventListener("blur", cancelSelection);
            },
          };
        },
        props: {
          handleDOMEvents: {
            focus(view) {
              // Safari focuses synchronously inside Tiptap command chains. Wait until
              // their pending transaction is applied before changing the document.
              queueMicrotask(() => {
                if (
                  !view.isDestroyed &&
                  !selectingWithPointer &&
                  view.hasFocus()
                ) {
                  revealAtDomSelection(view);
                }
              });
              return false;
            },
            mousedown() {
              selectingWithPointer = true;
              return false;
            },
          },
          decorations(state) {
            const active = revealKey.getState(state)?.active;
            const node = active && state.doc.nodeAt(active.pos);
            return active && node?.attrs.markdownSource
              ? DecorationSet.create(state.doc, [
                  Decoration.node(active.pos, active.pos + node.nodeSize, {
                    ...(revealedClass ? { class: revealedClass } : {}),
                    "data-markdown-source": "true",
                  }),
                ])
              : null;
          },
          handleTextInput(view, from, to, text) {
            if (!view.state.selection.$head.parent.attrs.markdownSource) {
              return false;
            }
            view.dispatch(view.state.tr.insertText(text, from, to));
            return true;
          },
          handleKeyDown(view, event) {
            if (view.composing || event.isComposing) {
              return false;
            }
            const { empty, $head } = view.state.selection;
            if (
              empty &&
              $head.parent.type.name === "markdownSource" &&
              !event.shiftKey &&
              !event.altKey &&
              !event.ctrlKey &&
              !event.metaKey &&
              ((event.key === "ArrowLeft" && $head.parentOffset === 0) ||
                (event.key === "ArrowRight" &&
                  $head.parentOffset === $head.parent.content.size))
            ) {
              // Browsers can keep the caret inside an inline content node at its edge.
              view.dispatch(
                view.state.tr
                  .setSelection(
                    TextSelection.create(
                      view.state.doc,
                      event.key === "ArrowLeft" ? $head.before() : $head.after()
                    )
                  )
                  .scrollIntoView()
              );
              return true;
            }
            if (
              view.state.selection.$head.parent.attrs.markdownSource &&
              event.key === "Enter"
            ) {
              view.dispatch(view.state.tr.insertText("\n").scrollIntoView());
              return true;
            }
            if (
              empty &&
              $head.parent.attrs.markdownSource &&
              ((event.key === "Backspace" && $head.parentOffset === 0) ||
                (event.key === "Delete" &&
                  $head.parentOffset === $head.parent.content.size))
            ) {
              prepareMarkdownCommand(editor);
            }
            if (
              (event.ctrlKey || event.metaKey) &&
              (["b", "e", "i"].includes(event.key.toLowerCase()) ||
                (event.shiftKey &&
                  ["b", "s"].includes(event.key.toLowerCase())))
            ) {
              prepareMarkdownCommand(editor);
            }
            return false;
          },
          handlePaste(view, event, slice) {
            if (!view.state.selection.$head.parent.attrs.markdownSource) {
              return false;
            }
            const text = event.clipboardData?.types.includes("text/plain")
              ? event.clipboardData.getData("text/plain")
              : undefined;
            let source = text;
            if (source === undefined) {
              // A slice of only inline nodes cannot fill a `doc`; serialize it
              // as plain text instead of throwing inside the paste handler.
              try {
                source = serialize(
                  editor,
                  editor.schema.nodes.doc.create(null, slice.content)
                );
              } catch {
                source = slice.content.textBetween(
                  0,
                  slice.content.size,
                  "\n\n",
                  "\n"
                );
              }
            }
            view.dispatch(view.state.tr.insertText(source));
            return true;
          },
        },
      }),
    ];
  },
  name: "markdownReveal",
  priority: 1100,
});
