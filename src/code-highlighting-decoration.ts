import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { DecorationAttrs } from "@tiptap/pm/view";

import { textAttribute } from "./attributes";
import {
  defaultCodeHighlightThemes,
  highlightCode,
} from "./code-highlighting";
import type {
  CodeHighlightTheme,
  CodeHighlightThemes,
  CodeHighlightToken,
} from "./code-highlighting";

export type { CodeHighlightTheme } from "./code-highlighting";

export type CodeHighlightTokenColor =
  | string
  | null
  | ((token: CodeHighlightToken) => string | null | undefined);

export type CodeHighlightDecorationAttributes =
  | DecorationAttrs
  | ((token: CodeHighlightToken) => DecorationAttrs);

/** Controls Shiki themes and inline decorations applied to syntax tokens. */
export interface CodeHighlightingOptions {
  /** Shiki themes for light and dark color schemes. */
  themes: CodeHighlightThemes;
  /** Emit a token's color as inline CSS. Defaults to `true`. */
  inlineColor: boolean;
  /** Replace the theme-derived token color. `null` or `undefined` omits it. */
  tokenColor: CodeHighlightTokenColor | undefined;
  /** Class applied to each syntax token. Set to an empty string to omit it. */
  decorationClass:
    | string
    | ((token: CodeHighlightToken) => string);
  /** Extra attributes applied to each syntax token decoration. */
  decorationAttributes: CodeHighlightDecorationAttributes;
}

/** @internal Builds token decoration attrs separately so custom styling stays testable. */
export function getCodeHighlightDecorationAttributes(
  token: CodeHighlightToken,
  options: CodeHighlightingOptions
): DecorationAttrs {
  const extraAttributes =
    typeof options.decorationAttributes === "function"
      ? options.decorationAttributes(token)
      : options.decorationAttributes;
  const configuredClass =
    typeof options.decorationClass === "function"
      ? options.decorationClass(token)
      : options.decorationClass;
  const className = [configuredClass, extraAttributes.class]
    .filter((value): value is string => Boolean(value))
    .join(" ");
  const configuredColor = options.inlineColor
    ? typeof options.tokenColor === "function"
      ? options.tokenColor(token)
      : options.tokenColor === undefined
        ? token.color
        : options.tokenColor
    : undefined;
  const style = [
    extraAttributes.style,
    configuredColor ? `color: ${configuredColor}` : undefined,
  ]
    .filter((value): value is string => Boolean(value))
    .join("; ");
  const attributes: DecorationAttrs = {
    ...extraAttributes,
    ...(className ? { class: className } : {}),
    ...(style ? { style } : {}),
  };
  if (!className) {
    delete attributes.class;
  }
  if (!style) {
    delete attributes.style;
  }
  return attributes;
}

/** Decorations leave the editable document, Markdown serialization, and undo history intact. */
export const CodeHighlighting = Extension.create<CodeHighlightingOptions>({
  addOptions() {
    return {
      themes: defaultCodeHighlightThemes,
      inlineColor: true,
      tokenColor: undefined,
      decorationClass: "editor__syntax-token",
      decorationAttributes: {},
    };
  },
  addProseMirrorPlugins() {
    const options = this.options;
    const key = new PluginKey<DecorationSet>("codeHighlighting");
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: () => DecorationSet.empty,
          apply: (transaction, decorations) => {
            const highlighted: unknown = transaction.getMeta(key);
            // Keep stale tokens mapped through edits instead of flashing to
            // plain text; the async pass replaces them shortly after.
            return highlighted instanceof DecorationSet
              ? highlighted
              : transaction.docChanged
                ? decorations.map(transaction.mapping, transaction.doc)
                : decorations;
          },
        },
        props: { decorations: (state) => key.getState(state) },
        view(view) {
          let destroyed = false;
          let version = 0;
          const highlight = () => {
            const { doc } = view.state;
            version += 1;
            const request = version;
            const blocks: Promise<Decoration[]>[] = [];
            doc.descendants((node, position) => {
              if (node.type.name !== "codeBlock") {
                return;
              }
              blocks.push(
                highlightCode(
                  node.textContent,
                  textAttribute(node.attrs.language, "text"),
                  options.themes
                ).then((tokens) =>
                  tokens.map((token) =>
                    Decoration.inline(
                      position + 1 + token.offset,
                      position + 1 + token.offset + token.content.length,
                      getCodeHighlightDecorationAttributes(token, options)
                    )
                  )
                )
              );
              return false;
            });
            if (!blocks.length) {
              // The last code block left the document (for example converted
              // to a paragraph): decorations mapped onto surviving text must
              // be cleared or their colors linger on non-code content.
              const stale = key.getState(view.state);
              if (stale && stale.find().length > 0) {
                view.dispatch(
                  view.state.tr
                    .setMeta(key, DecorationSet.empty)
                    .setMeta("addToHistory", false)
                    .setMeta("preventUpdate", true)
                );
              }
              return;
            }
            void Promise.all(blocks).then((decorations) => {
              if (destroyed || request !== version || !view.state.doc.eq(doc)) {
                return;
              }
              view.dispatch(
                view.state.tr
                  .setMeta(key, DecorationSet.create(doc, decorations.flat()))
                  .setMeta("addToHistory", false)
                  .setMeta("preventUpdate", true)
              );
            });
          };
          highlight();
          return {
            update(current, previous) {
              if (!current.state.doc.eq(previous.doc)) {
                highlight();
              }
            },
            destroy() {
              destroyed = true;
            },
          };
        },
      }),
    ];
  },
  name: "codeHighlighting",
});
