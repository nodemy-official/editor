import { Extension } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";

import { textAttribute } from "./attributes";
import { markdownDestination, markdownTitle } from "./markdown-escape";

/**
 * Serialize-only inline node for `code` mark runs. Tiptap's code mark emits
 * single-backtick delimiters derived from a placeholder render, so backticks
 * inside the span merge with the fences and disappear on reparse
 * (` `` `x` `` ` becomes `x`). Paragraph/heading serializers rewrite marked
 * text runs to this JSON node, which emits a content-aware fence instead.
 */
export const MarkdownCodeSpan = Extension.create({
  name: "markdownCodeSpan",
  renderMarkdown(node: JSONContent) {
    const text = textAttribute(node.attrs?.text);
    if (!text) {
      return "";
    }
    const fence = "`".repeat(
      (text.match(/`+/gu) ?? []).reduce(
        (length, run) => Math.max(length, run.length + 1),
        1
      )
    );
    // CommonMark strips one boundary space pair from fenced content, so pad
    // once whenever the content would touch the fence with a backtick or
    // keeps a significant space at either edge (all-whitespace spans stay
    // unpadded since the rule only applies to mixed content).
    const padded =
      /^`|`$/u.test(text) ||
      ((/^\s/u.test(text) || /\s$/u.test(text)) && /\S/u.test(text))
        ? ` ${text} `
        : text;
    // The serializer only emits mark delimiters around text nodes, so the
    // remaining marks are wrapped here, innermost first.
    let span = `${fence}${padded}${fence}`;
    for (const mark of (node.marks ?? []).toReversed()) {
      if (mark.type === "link") {
        const href = markdownDestination(textAttribute(mark.attrs?.href));
        const title = markdownTitle(textAttribute(mark.attrs?.title));
        span = `[${span}](${href}${title})`;
      } else if (mark.type === "bold") {
        span = `**${span}**`;
      } else if (mark.type === "italic") {
        span = `*${span}*`;
      } else if (mark.type === "strike") {
        span = `~~${span}~~`;
      }
    }
    return span;
  },
});

const sameMarks = (first: JSONContent["marks"], second: JSONContent["marks"]) =>
  JSON.stringify(first ?? []) === JSON.stringify(second ?? []);

/**
 * Apply `transform` to each chunk of `text` that lies outside backtick code
 * spans, leaving span content untouched unless `transformCodeSpan` is provided.
 * Delimiter matching follows CommonMark
 * (`n` backticks close only a run of exactly `n`), and `\x` escape pairs are
 * passed through so an escaped backtick cannot open a span. Serialized
 * Markdown often needs post-processing that must not corrupt code spans
 * (escaping a `[^x]:` line start, collapsing table-cell whitespace, …).
 */
function codeSpanCloser(text: string, index: number, run: number) {
  let cursor = index + run;
  while (cursor < text.length) {
    if (text[cursor] !== "`") {
      cursor += 1;
      continue;
    }
    let length = 0;
    while (text[cursor + length] === "`") {
      length += 1;
    }
    if (length === run) {
      return cursor;
    }
    cursor += length;
  }
  return -1;
}

function backtickRun(text: string, index: number) {
  let run = 0;
  while (text[index + run] === "`") {
    run += 1;
  }
  return run;
}

function plainChunkEnd(text: string, index: number) {
  let end = index + 1;
  while (end < text.length && text[end] !== "`" && text[end] !== "\\") {
    end += 1;
  }
  return end;
}

export function mapOutsideCodeSpans(
  text: string,
  transform: (chunk: string) => string,
  transformCodeSpan: (span: string) => string = (span) => span
) {
  let output = "";
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === "\\" && index + 1 < text.length) {
      output += text.slice(index, index + 2);
      index += 2;
      continue;
    }
    if (char === "`") {
      const run = backtickRun(text, index);
      const closer = codeSpanCloser(text, index, run);
      if (closer === -1) {
        output += transform(text.slice(index, index + run));
        index += run;
      } else {
        output += transformCodeSpan(text.slice(index, closer + run));
        index = closer + run;
      }
      continue;
    }
    const end = plainChunkEnd(text, index);
    output += transform(text.slice(index, end));
    index = end;
  }
  return output;
}

// Single-backtick fences lose any inner run (`a`b`) and whitespace at the
// edges (`a `, ` a`, ` x `): the text serializer moves partial-edge spaces
// outside the mark and drops whitespace-only runs entirely. Only those runs
// need the wider fence.
const needsWiderFence = (text: string) =>
  text.includes("`") || /^\s/u.test(text) || /\s$/u.test(text);

/** Rewrite `code`-marked text runs into `markdownCodeSpan` JSON for serialization. */
export function inlineCodeSpans(content: JSONContent[] | undefined) {
  if (
    !content?.some((child) => child.marks?.some((mark) => mark.type === "code"))
  ) {
    return content;
  }
  const transformed: JSONContent[] = [];
  let run: { marks: NonNullable<JSONContent["marks"]>; text: string } | null =
    null;
  const flush = () => {
    if (!run) {
      return;
    }
    if (needsWiderFence(run.text)) {
      const marks = run.marks.filter((mark) => mark.type !== "code");
      transformed.push({
        type: "markdownCodeSpan",
        attrs: { text: run.text },
        ...(marks.length ? { marks } : {}),
      });
    } else {
      transformed.push({ type: "text", text: run.text, marks: run.marks });
    }
    run = null;
  };
  for (const child of content) {
    if (
      child.type === "text" &&
      child.marks?.some((mark) => mark.type === "code")
    ) {
      if (run && sameMarks(run.marks, child.marks)) {
        run.text += child.text ?? "";
      } else {
        flush();
        run = { marks: child.marks, text: child.text ?? "" };
      }
      continue;
    }
    flush();
    transformed.push(child);
  }
  flush();
  return transformed;
}
