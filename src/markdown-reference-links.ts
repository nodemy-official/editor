import { Node, mergeAttributes } from "@tiptap/core";
import type {
  AnyExtension,
  JSONContent,
  MarkdownParseHelpers,
  MarkdownParseResult,
  MarkdownRendererHelpers,
  MarkdownToken,
  RenderContext,
} from "@tiptap/core";

import { textAttribute } from "./attributes";
import { markdownDestination, markdownTitle } from "./markdown-escape";

export interface MarkdownReferenceLink {
  /** The spelling used by the source link. */
  kind: "full" | "collapsed" | "shortcut";
  /** The reference label to write after the second pair of brackets. */
  label: string;
  /** The first link label as it appeared in Markdown. */
  sourceText: string;
  /** Link destination when the reference was parsed. */
  href: string;
  /** Link title when the reference was parsed. */
  title: string | null;
}

function closingBracket(source: string, openingIndex = 0) {
  if (source[openingIndex] !== "[") return -1;
  let depth = 0;
  for (let index = openingIndex; index < source.length; index += 1) {
    const character = source[index];
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (character === "[") depth += 1;
    if (character === "]") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

/** Returns the reference syntax represented by a Marked link token, if any. */
export function getMarkdownReferenceLink(
  token: MarkdownToken
): MarkdownReferenceLink | null {
  const raw = textAttribute(token.raw);
  if (token.type !== "link" || !raw.startsWith("[")) return null;

  const firstClose = closingBracket(raw);
  if (firstClose < 0) return null;
  const sourceText = raw.slice(1, firstClose);
  const afterLabel = raw.slice(firstClose + 1);

  let kind: MarkdownReferenceLink["kind"];
  let label: string;
  if (afterLabel === "") {
    kind = "shortcut";
    label = sourceText;
  } else if (afterLabel.startsWith("(") || !afterLabel.startsWith("[")) {
    return null;
  } else if (afterLabel.endsWith("]")) {
    const explicitLabel = afterLabel.slice(1, -1);
    kind = explicitLabel ? "full" : "collapsed";
    label = explicitLabel || sourceText;
  } else {
    return null;
  }

  return {
    kind,
    label,
    sourceText,
    href: textAttribute(token.href),
    title: textAttribute(token.title) || null,
  };
}

function isMarkdownReferenceLink(value: unknown): value is MarkdownReferenceLink {
  if (!value || typeof value !== "object") return false;
  const reference = value as Partial<MarkdownReferenceLink>;
  return (
    (reference.kind === "full" ||
      reference.kind === "collapsed" ||
      reference.kind === "shortcut") &&
    typeof reference.label === "string" &&
    typeof reference.sourceText === "string" &&
    typeof reference.href === "string" &&
    (typeof reference.title === "string" || reference.title === null)
  );
}

function addReferenceAttributeToResult(
  result: unknown,
  reference: MarkdownReferenceLink
): unknown {
  if (Array.isArray(result)) {
    return result.map((item) => addReferenceAttributeToResult(item, reference));
  }
  if (!result || typeof result !== "object") return result;

  const value = result as Record<string, unknown>;
  if (value.mark === "link") {
    return {
      ...value,
      attrs: {
        ...(value.attrs && typeof value.attrs === "object" ? value.attrs : {}),
        markdownReference: reference,
      },
    };
  }
  if (Array.isArray(value.marks)) {
    return {
      ...value,
      marks: value.marks.map((mark) => {
        if (!mark || typeof mark !== "object") return mark;
        const item = mark as Record<string, unknown>;
        return item.type === "link"
          ? {
              ...item,
              attrs: {
                ...(item.attrs && typeof item.attrs === "object"
                  ? item.attrs
                  : {}),
                markdownReference: reference,
              },
            }
          : item;
      }),
    };
  }
  if (Array.isArray(value.content)) {
    return {
      ...value,
      content: value.content.map((item) =>
        addReferenceAttributeToResult(item, reference)
      ),
    };
  }
  return value;
}

function linkDestination(node: {
  attrs?: { href?: unknown; title?: unknown };
}, children: string) {
  return `[${children}](${markdownDestination(
    textAttribute(node.attrs?.href)
  )}${markdownTitle(textAttribute(node.attrs?.title))})`;
}

/** Render one link mark, retaining its reference form when its target is intact. */
export function renderMarkdownLink(
  node: {
    attrs?: {
      href?: unknown;
      title?: unknown;
      markdownReference?: unknown;
    };
  },
  children: string
) {
  const reference = node.attrs?.markdownReference;
  const href = textAttribute(node.attrs?.href);
  const title = textAttribute(node.attrs?.title) || null;
  if (
    isMarkdownReferenceLink(reference) &&
    href === reference.href &&
    title === reference.title
  ) {
    // MarkdownManager calls mark renderers with a placeholder to discover
    // delimiters, so they cannot tell whether shortcut/collapsed link text has
    // changed. Emit an explicit label for every reference to keep its
    // destination valid after arbitrary text edits.
    return `[${children}][${reference.label}]`;
  }
  return linkDestination(node, children);
}

/**
 * Adds source-reference metadata to Tiptap's existing `link` mark. Apply this
 * after the host has installed its normal Markdown parse and render handlers.
 */
export function withMarkdownReferenceLinkAttributes(
  extension: AnyExtension
) {
  return extension.extend({
    addAttributes(this: { parent?: () => Record<string, unknown> }) {
      return {
        ...this.parent?.(),
        markdownReference: {
          default: null,
          rendered: false,
          parseHTML: (element: HTMLElement) => {
            const value = element.dataset.markdownReference;
            if (!value) return null;
            try {
              const parsed: unknown = JSON.parse(value);
              return isMarkdownReferenceLink(parsed) ? parsed : null;
            } catch {
              return null;
            }
          },
          renderHTML: (attributes: { markdownReference?: unknown }) =>
            isMarkdownReferenceLink(attributes.markdownReference)
              ? {
                  "data-markdown-reference": JSON.stringify(
                    attributes.markdownReference
                  ),
                }
              : {},
        },
      };
    },
    parseMarkdown(
      this: {
        parent?: (
          token: MarkdownToken,
          helpers: MarkdownParseHelpers
        ) => MarkdownParseResult | undefined;
      },
      token: MarkdownToken,
      helpers: MarkdownParseHelpers
    ) {
      const parsed = this.parent?.(token, helpers);
      const reference = getMarkdownReferenceLink(token);
      return reference && parsed
        ? addReferenceAttributeToResult(parsed, reference)
        : parsed;
    },
    renderMarkdown(
      this: {
        parent?: (
          node: JSONContent,
          helpers: MarkdownRendererHelpers,
          context: RenderContext
        ) => string | undefined;
      },
      node: JSONContent,
      helpers: MarkdownRendererHelpers,
      context: RenderContext
    ) {
      const children = helpers.renderChildren(node);
      const reference = node.attrs?.markdownReference;
      const href = textAttribute(node.attrs?.href);
      const title = textAttribute(node.attrs?.title) || null;
      if (
        isMarkdownReferenceLink(reference) &&
        href === reference.href &&
        title === reference.title
      ) {
        return renderMarkdownLink(node, children);
      }
      const parent = this.parent?.(node, helpers, context);
      return typeof parent === "string" && parent
        ? parent
        : linkDestination(node, children);
    },
  });
}

function definitionLabel(raw: string, fallback: string) {
  const opening = raw.indexOf("[");
  const close = closingBracket(raw, opening);
  return close > opening ? raw.slice(opening + 1, close) : fallback;
}

function escapedDefinitionLabel(label: string) {
  return label.replaceAll(/([\\[\]])/gu, "\\$1");
}

/** CommonMark reference definition node produced by Marked's `def` token. */
export const MarkdownReferenceDefinition = Node.create({
  name: "markdownReferenceDefinition",
  markdownTokenName: "def",

  addAttributes() {
    return {
      label: {
        default: "",
        parseHTML: (element: HTMLElement) => element.dataset.referenceLabel,
        renderHTML: (attributes: { label?: unknown }) => ({
          "data-reference-label": textAttribute(attributes.label),
        }),
      },
      href: {
        default: "",
        parseHTML: (element: HTMLElement) => element.dataset.referenceHref,
        renderHTML: (attributes: { href?: unknown }) => ({
          "data-reference-href": textAttribute(attributes.href),
        }),
      },
      title: {
        default: null,
        parseHTML: (element: HTMLElement) => element.dataset.referenceTitle || null,
        renderHTML: (attributes: { title?: unknown }) =>
          typeof attributes.title === "string"
            ? { "data-reference-title": attributes.title }
            : {},
      },
      sourceLabel: { default: "", rendered: false },
      sourceRaw: { default: "", rendered: false },
      sourceHref: { default: "", rendered: false },
      sourceTitle: { default: null, rendered: false },
    };
  },

  atom: true,
  group: "block",
  selectable: true,

  parseHTML() {
    return [{ tag: "div[data-markdown-reference-definition]" }];
  },

  parseMarkdown(token, helpers) {
    const sourceRaw = textAttribute(token.raw).replace(/[\r\n]+$/u, "");
    const sourceLabel = definitionLabel(
      sourceRaw,
      textAttribute(token.tag)
    );
    const href = textAttribute(token.href);
    const title = textAttribute(token.title) || null;
    return helpers.createNode("markdownReferenceDefinition", {
      label: sourceLabel,
      href,
      title,
      sourceLabel,
      sourceRaw,
      sourceHref: href,
      sourceTitle: title,
    });
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-markdown-reference-definition": "",
      }),
    ];
  },

  renderMarkdown(node) {
    const label = textAttribute(node.attrs?.label);
    const sourceLabel = textAttribute(node.attrs?.sourceLabel, label);
    const href = textAttribute(node.attrs?.href);
    const title = textAttribute(node.attrs?.title) || null;
    const sourceHref = textAttribute(node.attrs?.sourceHref, href);
    const sourceTitle = textAttribute(node.attrs?.sourceTitle) || null;
    const sourceRaw = textAttribute(node.attrs?.sourceRaw);
    const labelUnchanged = sourceLabel === label;
    if (
      sourceRaw &&
      labelUnchanged &&
      href === sourceHref &&
      title === sourceTitle
    ) {
      return sourceRaw;
    }
    const renderedLabel = labelUnchanged
      ? sourceLabel
      : escapedDefinitionLabel(label);
    return `[${renderedLabel}]: ${markdownDestination(href)}${markdownTitle(title ?? "")}`;
  },
});
