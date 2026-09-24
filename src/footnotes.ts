import { Node, mergeAttributes } from "@tiptap/core";

import { textAttribute } from "./attributes";
import { markdownDestination, markdownTitle } from "./markdown-escape";

export interface FootnoteReferenceOptions {
  /** Accessible name for the rendered footnote marker. */
  ariaLabel: (label: string) => string;
  /** Visible marker text; the original label remains in Markdown and data attributes. */
  renderLabel: (label: string) => string;
  /** Attributes such as a host-owned class for styling the marker. */
  HTMLAttributes: Record<string, string>;
}

// GFM footnotes must survive visual edits to the surrounding prose.
export const FootnoteReference = Node.create<FootnoteReferenceOptions>({
  addAttributes() {
    return { label: { default: "1" } };
  },
  addOptions() {
    return {
      ariaLabel: (label: string) => `Footnote ${label}`,
      renderLabel: (label: string) => label,
      HTMLAttributes: {},
    };
  },
  atom: true,
  group: "inline",
  inline: true,
  // References support links so they stay clickable inside linked text.
  // Text formatting applies to the surrounding prose, not the marker.
  marks: "link",
  markdownTokenizer: {
    level: "inline",
    name: "footnoteReference",
    start: (source) => source.indexOf("[^"),
    tokenize(source) {
      const match = /^\[\^([^\]\s]+)\]/u.exec(source);
      if (match) {
        return { type: "footnoteReference", raw: match[0], label: match[1] };
      }
    },
  },
  name: "footnoteReference",
  parseHTML() {
    return [
      {
        tag: "sup[data-footnote]",
        getAttrs: (element) => ({
          label: element.dataset.footnote,
        }),
      },
    ];
  },
  parseMarkdown: (token, helpers) =>
    helpers.createNode("footnoteReference", {
      label: textAttribute(token.label, "1"),
    }),
  renderHTML({ node }) {
    const label = textAttribute(node.attrs?.label, "1");
    return [
      "sup",
      mergeAttributes(this.options.HTMLAttributes, {
        "data-footnote": label,
        "aria-label": this.options.ariaLabel(label),
      }),
      this.options.renderLabel(label),
    ];
  },
  renderMarkdown(node) {
    const reference = `[^${textAttribute(node.attrs?.label, "1")}]`;
    const link = node.marks?.find((mark) => mark.type === "link");
    return link
      ? `[${reference}](${markdownDestination(textAttribute(link.attrs?.href))}${markdownTitle(textAttribute(link.attrs?.title))})`
      : reference;
  },
});

export interface FootnoteDefinitionOptions {
  /** Accessible name for the rendered footnote definition. */
  ariaLabel: (label: string) => string;
  /** Attributes such as a host-owned class for styling the definition. */
  HTMLAttributes: Record<string, string>;
}

export const FootnoteDefinition = Node.create<FootnoteDefinitionOptions>({
  addAttributes() {
    return { label: { default: "1" } };
  },
  addOptions() {
    return {
      ariaLabel: (label: string) => `Footnote ${label}`,
      HTMLAttributes: {},
    };
  },
  content: "block+",
  defining: true,
  group: "block",
  markdownTokenizer: {
    level: "block",
    name: "footnoteDefinition",
    // `start` runs on `source.slice(1)`, so index 0 is never a real line
    // start; requiring a preceding newline also keeps `\[^a]:` escaped text
    // from splitting the paragraph. Up to three leading spaces are allowed.
    start: (source) => {
      const match = /\n {0,3}\[\^[^\]\s]+\]:/u.exec(source);
      return match ? match.index + 1 : -1;
    },
    tokenize(source, _tokens, lexer) {
      const match =
        /^ {0,3}\[\^([^\]\s]+)\]:[ \t]*([^\n]*(?:\n(?:[ \t]*\n)*(?: {4}|\t)[^\n]*)*)(?:\n|$)/u.exec(
          source
        );
      if (!match) {
        return;
      }
      const body = match[2].replaceAll(/\n(?: {4}|\t)/gu, "\n");
      return {
        type: "footnoteDefinition",
        raw: match[0],
        label: match[1],
        tokens: lexer.blockTokens(body),
      };
    },
  },
  name: "footnoteDefinition",
  parseHTML() {
    return [
      {
        tag: "div[data-footnote-definition]",
        getAttrs: (element) => ({
          label: element.dataset.footnoteDefinition,
        }),
      },
    ];
  },
  parseMarkdown: (token, helpers) => {
    const content = helpers.parseChildren(token.tokens ?? []);
    return helpers.createNode(
      "footnoteDefinition",
      { label: textAttribute(token.label, "1") },
      content.length ? content : [helpers.createNode("paragraph")]
    );
  },
  renderHTML({ node }) {
    const label = textAttribute(node.attrs?.label, "1");
    return [
      "div",
      mergeAttributes(this.options.HTMLAttributes, {
        "aria-label": this.options.ariaLabel(label),
        "data-footnote-definition": label,
        role: "note",
      }),
      0,
    ];
  },
  renderMarkdown: (node, helpers) => {
    // Only content lines take the continuation indent; blank lines between
    // blocks stay empty so the output has no trailing whitespace.
    const body = helpers
      .renderChildren(node, "\n\n")
      .replaceAll(/\n(?=.)/gu, "\n    ");
    const label = textAttribute(node.attrs?.label, "1");
    return body ? `[^${label}]: ${body}` : `[^${label}]:`;
  },
});
