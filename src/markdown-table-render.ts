import type { JSONContent, MarkdownRendererHelpers } from "@tiptap/core";

import { mapOutsideCodeSpans } from "./markdown-code-span";

const MINIMUM_CELL_WIDTH = 3;

type TableCellAlign = "left" | "right" | "center";

const cellAlignments = new Set<TableCellAlign>(["left", "right", "center"]);

const pad = (text: string, width: number) =>
  text + " ".repeat(Math.max(0, width - text.length));

function cellAlign(attrs: JSONContent["attrs"]): TableCellAlign | null {
  const align: unknown = attrs?.align;
  return typeof align === "string" &&
    cellAlignments.has(align as TableCellAlign)
    ? (align as TableCellAlign)
    : null;
}

/**
 * Table cells live on a single line, so bare pipes escape (a literal `|`
 * would otherwise split the cell on reparse), and line breaks become `<br>`
 * tags. Preserve other whitespace, including inside link destinations and
 * titles. GFM requires pipe escaping even inside code spans. Line endings
 * inside a span flatten to a single space as CommonMark normalizes them.
 */
function collapseCellWhitespace(raw: string) {
  return mapOutsideCodeSpans(
    raw,
    (chunk) =>
      chunk
        .replace(/[ \t]*\r?\n[ \t]*/gu, "<br>")
        .replaceAll("|", String.raw`\|`),
    (span) => span.replaceAll("|", String.raw`\|`)
  )
    .replaceAll(/\r?\n/gu, " ")
    .trim();
}

/**
 * Vendored copy of `@tiptap/extension-table`'s `renderTableToMarkdown` (v3):
 * the upstream cell-text pass (`collapseWhitespace` plus `<br>` conversion)
 * runs over already-serialized Markdown and also collapses whitespace inside
 * backtick code spans, silently rewriting cell content such as `` `a  b` ``.
 * This version preserves code-span whitespace and escapes cell pipes for GFM.
 */
export function renderMarkdownTable(
  node: JSONContent,
  helpers: MarkdownRendererHelpers
) {
  if (!node?.content?.length) {
    return "";
  }

  const rows: {
    text: string;
    align: TableCellAlign | null;
  }[][] = [];

  node.content.forEach((rowNode) => {
    const cells: {
      text: string;
      align: TableCellAlign | null;
    }[] = [];

    if (rowNode.content) {
      rowNode.content.forEach((cellNode) => {
        const raw =
          cellNode.content && cellNode.content.length > 1
            ? cellNode.content
                .map((child) => helpers.renderChildren(child))
                .join("\n")
            : cellNode.content
              ? helpers.renderChildren(cellNode.content)
              : "";

        const text = collapseCellWhitespace(raw);
        const align = cellAlign(cellNode.attrs);

        cells.push({ text, align });
      });
    }

    rows.push(cells);
  });

  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);

  if (columnCount === 0) {
    return "";
  }

  const colWidths = Array.from<number>({ length: columnCount }).fill(0);

  rows.forEach((row) => {
    for (let index = 0; index < columnCount; index += 1) {
      const cell = row[index]?.text || "";
      const { length } = cell;
      if (length > colWidths[index]) {
        colWidths[index] = length;
      }

      if (colWidths[index] < MINIMUM_CELL_WIDTH) {
        colWidths[index] = MINIMUM_CELL_WIDTH;
      }
    }
  });

  const headerRow = rows[0];
  const colAlignments: (TableCellAlign | null)[] =
    Array.from<TableCellAlign | null>({ length: columnCount }).fill(null);

  rows.forEach((row) => {
    for (let index = 0; index < columnCount; index += 1) {
      if (!colAlignments[index] && row[index]?.align) {
        colAlignments[index] = row[index].align;
      }
    }
  });

  let out = "\n";

  // GFM requires a header row. When a ProseMirror table starts with regular
  // cells, use that row as the Markdown header instead of inserting an empty
  // header and serializing every original row as body content.
  const headerTexts = Array.from<number>({ length: columnCount }).map(
    (_, i) => headerRow[i]?.text || ""
  );

  out += `| ${headerTexts.map((text, index) => pad(text, colWidths[index])).join(" | ")} |\n`;

  out += `| ${colWidths
    .map((width, index) => {
      const dashCount = Math.max(MINIMUM_CELL_WIDTH, width);
      const alignment = colAlignments[index];

      if (alignment === "left") {
        return `:${"-".repeat(dashCount)}`;
      }
      if (alignment === "right") {
        return `${"-".repeat(dashCount)}:`;
      }
      if (alignment === "center") {
        return `:${"-".repeat(dashCount)}:`;
      }

      return "-".repeat(dashCount);
    })
    .join(" | ")} |\n`;

  const body = rows.slice(1);
  body.forEach((row) => {
    out += `| ${Array.from<number>({ length: columnCount })
      .fill(0)
      .map((_, index) => pad(row[index]?.text || "", colWidths[index]))
      .join(" | ")} |\n`;
  });

  return out;
}
