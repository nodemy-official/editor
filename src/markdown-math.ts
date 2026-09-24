import { Node, mergeAttributes } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { render } from "katex";
import type { KatexOptions } from "katex";
import "katex/contrib/mhchem";

import { textAttribute } from "./attributes";

export interface MarkdownMathOptions {
  /** KaTeX options. Unsafe HTML commands remain disabled. */
  katexOptions: KatexOptions;
  /** Attributes applied to the rendered math element. */
  HTMLAttributes: Record<string, string>;
}

function renderMath(
  element: HTMLElement,
  latex: string,
  displayMode: boolean,
  options: KatexOptions
) {
  try {
    render(latex, element, {
      ...options,
      displayMode,
      maxExpand: 1000,
      maxSize: 20,
      output: "htmlAndMathml",
      throwOnError: true,
      trust: false,
    });
    element.removeAttribute("data-math-error");
  } catch {
    // A partial formula must remain readable and repairable in the editor.
    element.textContent = latex;
    element.setAttribute("data-math-error", "true");
  }
}

function applyHTMLAttributes(
  element: HTMLElement,
  attributes: Record<string, string>
) {
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }
}

function inlineMathToken(source: string) {
  if (!source.startsWith("$") || source.startsWith("$$")) {
    return;
  }
  // In `$5-$6`, the second dollar starts another currency amount, but the
  // inline delimiter scan would treat it as the closing dollar for `5-`.
  if (/^\$(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?[-–—]\$\d/u.test(source)) {
    return;
  }
  const match = /^\$((?:\\.|[^\\$\n])+?)\$(?!\$)/u.exec(source);
  const latex = match?.[1];
  if (
    !match ||
    !latex ||
    latex.trim() !== latex ||
    // Avoid interpreting a price range such as "$5 and $6" as math.
    (/^\d/u.test(latex) && /\s/u.test(latex) && /^\d/u.test(source.slice(match[0].length)))
  ) {
    return;
  }
  return { type: "inlineMath", raw: match[0], latex };
}

/** `$...$` math inside Markdown prose. The consumer imports KaTeX CSS for visual styling. */
export const MarkdownInlineMath = Node.create<MarkdownMathOptions>({
  name: "inlineMath",
  group: "inline",
  inline: true,
  atom: true,
  addOptions: () => ({ katexOptions: {}, HTMLAttributes: {} }),
  addAttributes: () => ({
    latex: { default: "" },
    source: { default: null, rendered: false },
    originalLatex: { default: null, rendered: false },
  }),
  markdownTokenizer: {
    name: "inlineMath",
    level: "inline",
    start: (source) => source.indexOf("$"),
    tokenize: inlineMathToken,
  },
  parseMarkdown: (token, helpers) =>
    helpers.createNode("inlineMath", {
      latex: textAttribute(token.latex),
      source: textAttribute(token.raw),
      originalLatex: textAttribute(token.latex),
    }),
  parseHTML: () => [
    {
      tag: "span[data-markdown-inline-math]",
      getAttrs: (element) => ({ latex: element.dataset.markdownInlineMath }),
    },
  ],
  renderHTML({ node }) {
    const latex = textAttribute(node.attrs.latex);
    return [
      "span",
      mergeAttributes(this.options.HTMLAttributes, {
        "data-markdown-inline-math": latex,
      }),
      latex,
    ];
  },
  addNodeView() {
    const options = this.options;
    return ({ node, view }) => {
      const dom = view.dom.ownerDocument.createElement("span");
      applyHTMLAttributes(dom, options.HTMLAttributes);
      dom.contentEditable = "false";
      const update = (current: typeof node) => {
        const latex = textAttribute(current.attrs.latex);
        dom.dataset.markdownInlineMath = latex;
        renderMath(dom, latex, false, options.katexOptions);
      };
      update(node);
      return {
        dom,
        update(next) {
          if (next.type !== node.type) return false;
          update(next);
          return true;
        },
        ignoreMutation: () => true,
      };
    };
  },
  renderText: ({ node }) => `$${textAttribute(node.attrs.latex)}$`,
  renderMarkdown(node) {
    const latex = textAttribute(node.attrs?.latex);
    return node.attrs?.originalLatex === latex && node.attrs?.source
      ? textAttribute(node.attrs.source)
      : `$${latex}$`;
  },
});

function blockMathToken(source: string) {
  const opener = /^ {0,3}(\${2,})[ \t]*\n/u.exec(source);
  if (!opener) return;
  const rest = source.slice(opener[0].length);
  const closer = /^ {0,3}(\${2,})[ \t]*(?:\n|$)/gmu;
  let match: RegExpExecArray | null;
  do {
    match = closer.exec(rest);
  } while (match && match[1].length < opener[1].length);
  if (!match) return;
  const latex = rest.slice(0, match.index).replace(/\n$/u, "");
  const raw = source.slice(0, opener[0].length + match.index + match[0].length);
  return { type: "blockMath", raw, latex, fenceLength: opener[1].length };
}

/** A fenced `$$` Markdown math block. */
export const MarkdownBlockMath = Node.create<MarkdownMathOptions>({
  name: "blockMath",
  group: "block",
  atom: true,
  defining: true,
  addOptions: () => ({ katexOptions: {}, HTMLAttributes: {} }),
  addAttributes: () => ({
    latex: { default: "" },
    source: { default: null, rendered: false },
    originalLatex: { default: null, rendered: false },
    fenceLength: { default: 2, rendered: false },
  }),
  markdownTokenizer: {
    name: "blockMath",
    level: "block",
    start: (source) => {
      const match = /\n {0,3}\${2,}[ \t]*\n/u.exec(source);
      return match ? match.index + 1 : -1;
    },
    tokenize: blockMathToken,
  },
  parseMarkdown: (token, helpers) =>
    helpers.createNode("blockMath", {
      latex: textAttribute(token.latex),
      source: textAttribute(token.raw).replace(/\n$/u, ""),
      originalLatex: textAttribute(token.latex),
      fenceLength: Number(token.fenceLength) || 2,
    }),
  parseHTML: () => [
    {
      tag: "div[data-markdown-block-math]",
      getAttrs: (element) => ({ latex: element.dataset.markdownBlockMath }),
    },
  ],
  renderHTML({ node }) {
    const latex = textAttribute(node.attrs.latex);
    return [
      "div",
      mergeAttributes(this.options.HTMLAttributes, {
        "data-markdown-block-math": latex,
      }),
      latex,
    ];
  },
  addNodeView() {
    const options = this.options;
    return ({ node, view, getPos }) => {
      const dom = view.dom.ownerDocument.createElement("div");
      applyHTMLAttributes(dom, options.HTMLAttributes);
      dom.contentEditable = "false";
      let clickTimer: ReturnType<typeof setTimeout> | undefined;
      const selectForEditing = () => {
        if (!view.editable) return;
        // ProseMirror finishes its pointer selection after mouseup. Select the
        // atom afterwards so MarkdownReveal can expose its editable source.
        clearTimeout(clickTimer);
        clickTimer = setTimeout(() => {
          if (view.isDestroyed) return;
          view.focus();
          const pos = getPos();
          if (typeof pos !== "number") return;
          view.dispatch(
            view.state.tr
              .setSelection(NodeSelection.create(view.state.doc, pos))
          );
        }, 0);
      };
      dom.addEventListener("click", selectForEditing);
      const update = (current: typeof node) => {
        const latex = textAttribute(current.attrs.latex);
        dom.dataset.markdownBlockMath = latex;
        renderMath(dom, latex, true, options.katexOptions);
      };
      update(node);
      return {
        dom,
        update(next) {
          if (next.type !== node.type) return false;
          update(next);
          return true;
        },
        ignoreMutation: () => true,
        destroy() {
          clearTimeout(clickTimer);
          dom.removeEventListener("click", selectForEditing);
        },
      };
    };
  },
  renderText: ({ node }) => `$$\n${textAttribute(node.attrs.latex)}\n$$`,
  renderMarkdown(node) {
    const latex = textAttribute(node.attrs?.latex);
    if (node.attrs?.originalLatex === latex && node.attrs?.source) {
      return textAttribute(node.attrs.source);
    }
    const longestInnerFence = [...latex.matchAll(/^ {0,3}(\${2,})[ \t]*$/gmu)]
      .reduce((length, match) => Math.max(length, match[1].length), 0);
    const fence = "$".repeat(
      Math.max(2, Number(node.attrs?.fenceLength) || 2, longestInnerFence + 1)
    );
    return `${fence}\n${latex}\n${fence}`;
  },
});
