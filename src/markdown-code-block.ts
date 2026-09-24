import { CodeBlock } from "@tiptap/extension-code-block";

import { textAttribute } from "./attributes";

/** Fenced code block that preserves the CommonMark info string (language plus trailing metadata). */
export const MarkdownCodeBlock = CodeBlock.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      codeMeta: {
        default: null,
        parseHTML: (element) => element.dataset.codeMeta,
        renderHTML: (attributes) =>
          typeof attributes.codeMeta === "string"
            ? { "data-code-meta": attributes.codeMeta }
            : {},
      },
    };
  },
  parseMarkdown(token, helpers) {
    const info = /^ {0,3}(?:`{3,}|~{3,})[ \t]*([^\r\n]*)$/u
      .exec(token.raw?.split("\n", 1)[0] ?? "")?.[1]
      ?.trim();
    const space = info?.search(/\s/u) ?? -1;
    const language = info ? (space === -1 ? info : info.slice(0, space)) : null;
    const codeMeta =
      info && space !== -1 ? info.slice(space).trim() || null : null;
    const source = token.text ?? "";
    return helpers.createNode(
      "codeBlock",
      { language, codeMeta },
      source ? [helpers.createTextNode(source)] : []
    );
  },
  renderMarkdown(node) {
    const source =
      node.content?.map((child) => child.text ?? "").join("") ?? "";
    // Info strings live on the fence line; a newline injected through document
    // JSON would break the fence and spill attributes into the code content.
    const meta = textAttribute(node.attrs?.codeMeta).replaceAll(
      /[\r\n]+/gu,
      " "
    );
    // A fence needs a language token before metadata, even for plain text.
    const language =
      textAttribute(node.attrs?.language)
        .replaceAll(/[\r\n]+/gu, " ")
        .trim() || (meta ? "text" : "");
    const info = [language, meta].filter(Boolean).join(" ");
    const character = info.includes("`") ? "~" : "`";
    const runs = source.match(character === "`" ? /`+/gu : /~+/gu) ?? [];
    const fence = character.repeat(
      runs.reduce((length, run) => Math.max(length, run.length + 1), 3)
    );
    return `${fence}${info}\n${source}\n${fence}`;
  },
});
