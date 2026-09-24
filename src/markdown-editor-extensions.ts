import { Extension, mergeAttributes } from "@tiptap/core";
import type {
  AnyExtension,
  MarkdownParseHelpers,
  MarkdownParseResult,
  MarkdownToken,
} from "@tiptap/core";
import { Image } from "@tiptap/extension-image";
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
import { FootnoteDefinition, FootnoteReference } from "./footnotes";
import type {
  FootnoteDefinitionOptions,
  FootnoteReferenceOptions,
} from "./footnotes";
import { MarkdownCodeBlock } from "./markdown-code-block";
import { MarkdownCodeSpan } from "./markdown-code-span";
import {
  BACKSLASH_ESCAPE,
  markdownDestination,
  markdownTitle,
} from "./markdown-escape";
import { MarkdownReveal, withMarkdownReveal } from "./markdown-reveal";
import type { MarkdownRevealOptions } from "./markdown-reveal";
import { MarkdownTable } from "./markdown-table";
import { TablePlaceholders } from "./table-placeholders";
import type { TablePlaceholdersOptions } from "./table-placeholders";

export function isSafeMarkdownLink(value: unknown) {
  if (typeof value !== "string") {
    return false;
  }
  const url = value.trim();
  if (
    !url ||
    [...url].some(
      // The spread iterator yields code points; charCodeAt reads the first
      // UTF-16 unit which is sufficient for the ASCII control-range check.
      (character) =>
        // oxlint-disable-next-line unicorn/prefer-code-point
        character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127
    )
  ) {
    return false;
  }
  // `/\x` normalizes to `//x` under WHATWG URL resolution, escaping the
  // origin; require the character after `/` to be neither `/` nor `\`.
  if (/^(?:#|\/(?![/\\])|\.\.?\/)/u.test(url)) {
    return true;
  }
  try {
    return ["https:", "http:", "mailto:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

const SafeImage = Image.extend({
  // Emphasis marks around a leaf image serialize dangling delimiters, while a
  // linked image `[![alt](src)](href)` is valid Markdown worth keeping.
  marks: "link",
  renderHTML({ HTMLAttributes }) {
    const src =
      typeof HTMLAttributes.src === "string" ? HTMLAttributes.src : "";
    const safe = isSafeMarkdownLink(src) && !/^mailto:/iu.test(src);
    return [
      "img",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        src: safe ? src : undefined,
      }),
    ];
  },
  renderMarkdown(node) {
    const src = textAttribute(node.attrs?.src);
    const alt = textAttribute(node.attrs?.alt).replace(
      /([\\[\]])/gu,
      BACKSLASH_ESCAPE
    );
    const image = `![${alt}](${markdownDestination(src)}${markdownTitle(
      textAttribute(node.attrs?.title)
    )})`;
    // The serializer only emits mark delimiters around text nodes, so a link
    // mark on this leaf is wrapped here to keep `[![alt](src)](href)` intact.
    const link = (node.marks ?? []).find((mark) => mark.type === "link");
    return link
      ? `[${image}](${markdownDestination(
          textAttribute(link.attrs?.href)
        )}${markdownTitle(textAttribute(link.attrs?.title))})`
      : image;
  },
});

const FormattingShortcuts = Extension.create<{ strikethrough: boolean }>({
  addOptions: () => ({ strikethrough: true }),
  addKeyboardShortcuts() {
    // `editor.commands` binds a fresh transaction per access, so the command
    // must be invoked lazily inside the shortcut rather than captured here.
    const suppressWhileComposing = (command: () => boolean) => () =>
      this.editor.view.composing || command();
    // `Mod-` is Cmd on macOS, so a physical Ctrl press would not reach any
    // binding. Mirroring each shortcut with `Control-` keeps literal Ctrl
    // chords working there; on other platforms they normalize to the same
    // `Ctrl-` key and simply overwrite each other. Shift+letter chords need
    // the uppercase spelling because `event.key` arrives already shifted.
    const bind = (command: () => boolean, ...keys: string[]) =>
      Object.fromEntries(
        keys.map((key) => [key, suppressWhileComposing(command)])
      );
    return {
      ...bind(
        () => this.editor.commands.toggleBold(),
        "Mod-b",
        "Mod-B",
        "Control-b",
        "Control-B"
      ),
      ...bind(
        () => this.editor.commands.toggleCode(),
        "Mod-e",
        "Mod-E",
        "Control-e",
        "Control-E"
      ),
      ...bind(
        () => this.editor.commands.toggleItalic(),
        "Mod-i",
        "Mod-I",
        "Control-i",
        "Control-I"
      ),
      ...bind(
        () => this.editor.commands.toggleBlockquote(),
        "Mod-Shift-b",
        "Mod-Shift-B",
        "Control-Shift-b",
        "Control-Shift-B"
      ),
      ...(this.options.strikethrough
        ? bind(
            () => this.editor.commands.toggleStrike(),
            "Mod-Shift-s",
            "Mod-Shift-S",
            "Control-Shift-s",
            "Control-Shift-S"
          )
        : {}),
    };
  },
  name: "markdownEditorFormattingShortcuts",
  // Runs before StarterKit's `Mod-` bindings so toggles are actually
  // suppressed during IME composition instead of racing the defaults.
  priority: 1050,
});

// Tiptap's default Markdown mark handler descends into every child. Inline
// parents need the mark on their boundary so an enclosing link includes the note.
function inlineParentStarterKit(footnotes: boolean) {
  return StarterKit.extend({
    addExtensions() {
      return (this.parent?.() ?? []).map((extension) => {
        if (!["bold", "italic", "strike", "link"].includes(extension.name)) {
          return withMarkdownReveal(extension, footnotes);
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
  const syntax =
    typeof options.extendedSyntax === "object" ? options.extendedSyntax : {};
  const extended = options.extendedSyntax !== false;
  const gfm = extended && syntax.gfm !== false;
  const footnotes = extended && syntax.footnotes !== false;
  const emojiShortcodes = extended && syntax.emojiShortcodes !== false;
  const {
    codeBlock = MarkdownCodeBlock,
    footnoteLabel,
    history = true,
    taskItemLabel,
  } = options;
  return [
    inlineParentStarterKit(footnotes).configure({
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
