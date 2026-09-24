import { mergeAttributes } from "@tiptap/core";
import type {
  AnyExtension,
  MarkdownParseHelpers,
  MarkdownParseResult,
  MarkdownToken,
} from "@tiptap/core";
import { Placeholder } from "@tiptap/extension-placeholder";
import { TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { TaskItem } from "@tiptap/extension-task-item";
import { TaskList } from "@tiptap/extension-task-list";
import { Markdown } from "@tiptap/markdown";
import { StarterKit } from "@tiptap/starter-kit";
import { Marked, type marked } from "marked";

import { textAttribute } from "./attributes";
import { CodeHighlighting } from "./code-highlighting-decoration";
import type { CodeHighlightingOptions } from "./code-highlighting-decoration";
import { EmojiDecorations } from "./emoji-decorations";
import type { EmojiDecorationsOptions } from "./emoji-decorations";
import { FormattingShortcuts } from "./formatting-shortcuts";
import { FootnoteDefinition, FootnoteReference } from "./footnotes";
import type {
  FootnoteDefinitionOptions,
  FootnoteReferenceOptions,
} from "./footnotes";
import { MarkdownCodeBlock } from "./markdown-code-block";
import { MarkdownCodeSpan } from "./markdown-code-span";
import { MarkdownBlockMath, MarkdownInlineMath } from "./markdown-math";
import type { MarkdownMathOptions } from "./markdown-math";
import { markdownDestination, markdownTitle } from "./markdown-escape";
import { MarkdownReveal, withMarkdownReveal } from "./markdown-reveal";
import type { MarkdownRevealOptions } from "./markdown-reveal";
import { isSafeMarkdownLink, SafeImage } from "./safe-markdown-media";
import { MarkdownTable } from "./markdown-table";
import { TablePlaceholders } from "./table-placeholders";
import type { TablePlaceholdersOptions } from "./table-placeholders";

export { isSafeMarkdownLink };

// Tiptap's default Markdown mark handler descends into every child. Inline
// parents need the mark on their boundary so an enclosing link includes the note.
function inlineParentStarterKit(
  footnotes: boolean,
  escapeInlineMathText: boolean
) {
  return StarterKit.extend({
    addExtensions() {
      return (this.parent?.() ?? []).map((extension) => {
        if (!["bold", "italic", "strike", "link"].includes(extension.name)) {
          return withMarkdownReveal(extension, footnotes, escapeInlineMathText);
        }
        return extension.extend({
          parseMarkdown(
            token: MarkdownToken,
            helpers: MarkdownParseHelpers
          ): MarkdownParseResult {
            const attrs =
              extension.name === "link"
                ? {
                    href: textAttribute(token.href),
                    title: textAttribute(token.title) || null,
                  }
                : undefined;
            const children = helpers.parseInline(token.tokens ?? []);
            return children.map((node) => {
              const withMark = {
                ...node,
                marks: [
                  ...(node.marks ?? []),
                  { type: extension.name, ...(attrs ? { attrs } : {}) },
                ],
              };
              if (node.type === "text") {
                return withMark;
              }
              // Leaf schemas support links; container inline nodes (annotations)
              // also retain formatting and render their own mark boundaries.
              return node.content || extension.name === "link"
                ? withMark
                : { ...node, marks: [] };
            });
          },
          ...(extension.name === "link"
            ? {
                renderHTML(
                  this: { options: { HTMLAttributes?: Record<string, unknown> } },
                  { HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }
                ) {
                  const { href } = HTMLAttributes;
                  return [
                    "a",
                    mergeAttributes(
                      this.options.HTMLAttributes ?? {},
                      HTMLAttributes,
                      {
                        href:
                          typeof href === "string" && isSafeMarkdownLink(href)
                            ? href
                            : undefined,
                      }
                    ),
                    0,
                  ];
                },
                renderMarkdown(
                  node: { attrs?: { href?: unknown; title?: unknown } },
                  helpers: {
                    renderChildren: (value: unknown) => string;
                  }
                ) {
                  return `[${helpers.renderChildren(node)}](${markdownDestination(
                    textAttribute(node.attrs?.href)
                  )}${markdownTitle(textAttribute(node.attrs?.title))})`;
                },
              }
            : {}),
        });
      });
    },
  });
}

/** Optional Markdown syntax beyond CommonMark. All groups are enabled by default. */
export interface ExtendedSyntaxOptions {
  /** GFM tables, task lists, strikethrough, and bare-URL autolinks. */
  gfm?: boolean;
  /** Footnote references and definitions. */
  footnotes?: boolean;
  /** Gemoji shortcode display such as `:smile:`. */
  emojiShortcodes?: boolean;
}

export interface MarkdownEditorExtensionsOptions {
  /** Set to `false` for CommonMark-only syntax, or toggle extension groups individually. */
  extendedSyntax?: ExtendedSyntaxOptions | boolean;
  /** Extra Tiptap extensions appended after the built-ins (annotations, math, …). */
  extensions?: AnyExtension[];
  /** Enable `$...$` and fenced `$$...$$` math. Disabled by default to allow existing custom math nodes. */
  math?: boolean | Partial<MarkdownMathOptions>;
  /** Code block node. Defaults to the info-string preserving `MarkdownCodeBlock`; `false` removes code block support. */
  codeBlock?: AnyExtension | false;
  /** Placeholder text shown while the caret sits in an empty block. Disabled when omitted. */
  placeholder?: string;
  /** Accessible label factory for task item checkboxes. */
  taskItemLabel?: (content: string) => string;
  /** Accessible name factory for footnote markers. */
  footnoteLabel?: (label: string) => string;
  /** Appearance and visible label of footnote references. */
  footnoteReference?: Partial<FootnoteReferenceOptions>;
  /** Appearance of footnote definitions. */
  footnoteDefinition?: Partial<FootnoteDefinitionOptions>;
  /** Enable the StarterKit undo/redo history. Defaults to `true`. */
  history?: boolean;
  /** Classes for the active Markdown source. */
  markdownReveal?: Partial<MarkdownRevealOptions>;
  /** Empty table-cell appearance and widget. Set to `false` to disable it. */
  tablePlaceholders?: Partial<TablePlaceholdersOptions> | false;
  /** Emoji appearance and widget. Set to `false` to disable it. */
  emojiDecorations?: Partial<EmojiDecorationsOptions> | false;
  /** Syntax theme and token appearance. Set to `false` to disable it. */
  codeHighlighting?: Partial<CodeHighlightingOptions> | false;
}

export function createMarkdownEditorExtensions(
  options: MarkdownEditorExtensionsOptions = {}
) {
  if (
    options.math &&
    options.extensions?.some((extension) =>
      ["inlineMath", "blockMath"].includes(extension.name)
    )
  ) {
    throw new Error(
      "math: true cannot be combined with custom inlineMath or blockMath extensions"
    );
  }
  const syntax =
    typeof options.extendedSyntax === "object" ? options.extendedSyntax : {};
  const extended = options.extendedSyntax !== false;
  const gfm = extended && syntax.gfm !== false;
  const footnotes = extended && syntax.footnotes !== false;
  const emojiShortcodes = extended && syntax.emojiShortcodes !== false;
  const escapeInlineMathText = Boolean(
    options.math ||
      options.extensions?.some((extension) => extension.name === "inlineMath")
  );
  const {
    codeBlock = MarkdownCodeBlock,
    footnoteLabel,
    history = true,
    taskItemLabel,
  } = options;
  return [
    inlineParentStarterKit(footnotes, escapeInlineMathText).configure({
      undoRedo: history ? undefined : false,
      codeBlock: false,
      strike: gfm ? undefined : false,
      underline: false,
      link: {
        HTMLAttributes: { rel: "noopener noreferrer" },
        isAllowedUri: isSafeMarkdownLink,
        openOnClick: false,
      },
    }),
    // TableKit minus its `start` heuristic: `MarkdownTable` only reports
    // extension start positions the tokenizer can actually accept, which keeps
    // paragraphs ahead of table-like lines from being split per character.
    ...(gfm
      ? [
          MarkdownTable.configure({ resizable: false }),
          TableCell,
          TableHeader,
          TableRow,
        ]
      : []),
    ...(!gfm || options.tablePlaceholders === false
      ? []
      : [
          options.tablePlaceholders
            ? TablePlaceholders.configure(options.tablePlaceholders)
            : TablePlaceholders,
        ]),
    ...(gfm
      ? [
          TaskList,
          TaskItem.configure({
            HTMLAttributes: { "data-type": "taskItem" },
            ...(taskItemLabel
              ? {
                  a11y: {
                    checkboxLabel: (node) => taskItemLabel(node.textContent),
                  },
                }
              : {}),
            nested: true,
          }),
        ]
      : []),
    SafeImage,
    ...(footnotes
      ? [
          footnoteLabel || options.footnoteDefinition
            ? FootnoteDefinition.configure({
                ...options.footnoteDefinition,
                ...(footnoteLabel ? { ariaLabel: footnoteLabel } : {}),
              })
            : FootnoteDefinition,
          footnoteLabel || options.footnoteReference
            ? FootnoteReference.configure({
                ...options.footnoteReference,
                ...(footnoteLabel ? { ariaLabel: footnoteLabel } : {}),
              })
            : FootnoteReference,
        ]
      : []),
    ...(options.codeHighlighting === false
      ? []
      : [
          options.codeHighlighting
            ? CodeHighlighting.configure(options.codeHighlighting)
            : CodeHighlighting,
        ]),
    MarkdownCodeSpan,
    ...(codeBlock ? [codeBlock] : []),
    ...(options.math
      ? [
          typeof options.math === "object"
            ? MarkdownInlineMath.configure(options.math)
            : MarkdownInlineMath,
          typeof options.math === "object"
            ? MarkdownBlockMath.configure(options.math)
            : MarkdownBlockMath,
        ]
      : []),
    ...(options.extensions ?? []),
    ...(!emojiShortcodes || options.emojiDecorations === false
      ? []
      : [
          options.emojiDecorations
            ? EmojiDecorations.configure(options.emojiDecorations)
            : EmojiDecorations,
        ]),
    FormattingShortcuts.configure({ strikethrough: gfm }),
    options.markdownReveal
      ? MarkdownReveal.configure(options.markdownReveal)
      : MarkdownReveal,
    ...(options.placeholder
      ? [Placeholder.configure({ placeholder: options.placeholder })]
      : []),
    // Tiptap defaults to marked's process-wide singleton. Each editor needs
    // its own tokenizer registry so different syntax options stay independent.
    // Tiptap types this option as the callable singleton, but only uses the
    // instance methods that Marked also implements.
    Markdown.configure({
      marked: new Marked() as unknown as typeof marked,
      markedOptions: { gfm },
    }),
  ];
}
