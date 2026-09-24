import { MarkdownManager } from "@tiptap/markdown";
import { describe, expect, it } from "vitest";

import { createMarkdownEditorExtensions } from "./markdown-editor-extensions";

const manager = new MarkdownManager({
  extensions: createMarkdownEditorExtensions(),
  markedOptions: { gfm: true },
});

const serialize = (doc: Parameters<MarkdownManager["serialize"]>[0]) =>
  manager.serialize(doc);

describe("markdown-table", () => {
  it("keeps a blockquote followed by a separator-looking line intact", () => {
    // The stock `start` heuristic truncates the paragraph to a single
    // character whenever a pipe-bearing line precedes `|---|`, even when the
    // candidate cannot be a table — the text used to shatter into one
    // single-character line per fragment.
    const doc = manager.parse("text|more\n| --- |\n> quote|\n> |---|\n> end");
    const paragraph = doc.content?.[0];
    expect(paragraph?.type).toBe("paragraph");
    const text = paragraph?.content?.[0];
    expect(text && "text" in text && text.text).toContain("text|more");
    // No single-character fragments: every text node holds real content.
    for (const node of doc.content ?? []) {
      for (const child of node.content ?? []) {
        expect(
          typeof child.text !== "string" || child.text.length > 1
        ).toBeTruthy();
      }
    }
    const serialized = serialize(doc);
    const reparsed = manager.parse(serialized);
    expect(manager.serialize(reparsed)).toBe(serialized);
  });

  it("does not split a pipe-bearing line before a separator row", () => {
    const doc = manager.parse("alpha|beta\n| --- |\n");
    const paragraph = doc.content?.[0];
    expect(paragraph?.type).toBe("paragraph");
    const text = paragraph?.content?.[0];
    expect(text && "text" in text && text.text).toContain("alpha|beta");
  });

  it("parses a table whose cells contain pipes inside code spans", () => {
    const doc = manager.parse("| `a|b` | c |\n| --- | --- |\n| `x|y` | z |");
    const table = doc.content?.[0];
    expect(table?.type).toBe("table");
    const headerCell = table?.content?.[0]?.content?.[0];
    const codeText = headerCell?.content?.[0]?.content?.[0];
    expect(codeText && "text" in codeText && codeText.text).toBe("a|b");
    expect(codeText?.marks?.some((mark) => mark.type === "code")).toBeTruthy();
  });

  it("parses a table that follows a paragraph without a blank line", () => {
    const doc = manager.parse("intro\n| `a|b` | c |\n| --- | --- |\n| 1 | 2 |");
    expect(doc.content?.[0]?.type).toBe("paragraph");
    expect(doc.content?.[1]?.type).toBe("table");
  });

  it.each(["a|b", "a || b", "`a|b`", String.raw`a\\|b`])(
    "exports code-span pipes as portable GFM: %j",
    (text) => {
      const cell = {
        type: "tableHeader",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text, marks: [{ type: "code" }] }],
          },
        ],
      };
      const doc = {
        type: "doc",
        content: [
          { type: "table", content: [{ type: "tableRow", content: [cell] }] },
        ],
      };
      const markdown = serialize(doc);
      // A lexer without the editor's permissive table extension represents
      // stricter consumers that require escaping pipes even inside code spans.
      const blocks = new manager.instance.Lexer({ gfm: true })
        .lex(markdown)
        .filter((token) => token.type !== "space");
      expect(blocks).toHaveLength(1);
      const [table] = blocks;
      expect(table?.type).toBe("table");
      if (table?.type !== "table") {
        return;
      }
      expect(table.header).toHaveLength(1);
      expect(table).toMatchObject({
        header: [{ tokens: [{ type: "codespan", text }] }],
      });
      const reparsed = manager.parse(markdown);
      expect(
        reparsed.content?.[0]?.content?.[0]?.content?.[0]?.content?.[0]
          ?.content?.[0]
      ).toMatchObject({
        text,
        marks: [{ type: "code" }],
      });
      expect(serialize(reparsed)).toBe(markdown);
    }
  );

  it("serializes code-span whitespace inside cells without collapsing", () => {
    const doc = manager.parse("| h |\n| --- |\n| `x  y` |");
    const serialized = serialize(doc);
    expect(serialized).toContain("`x  y`");
    const reparsed = manager.parse(serialized);
    const cell = reparsed.content?.[0]?.content?.[1]?.content?.[0];
    const text = cell?.content?.[0]?.content?.[0];
    expect(text && "text" in text && text.text).toBe("x  y");
  });

  it("preserves unit separator characters inside table cells", () => {
    const source = "| heading |\n| --- |\n| before\u001fafter |";
    const document = manager.parse(source);
    const markdown = serialize(document);

    expect(manager.parse(markdown)).toStrictEqual(document);
    expect(serialize(manager.parse(markdown))).toBe(markdown);
  });

  it.each([
    "two  spaces",
    "tab\t\tseparated",
    "non\u00A0breaking",
    "wide\u3000space",
    "[link](<https://example.com/a  b>)",
    '[link](https://example.com "two  spaces")',
    "![image](<https://example.com/a  b.png>)",
  ])("preserves significant cell whitespace: %j", (cell) => {
    const document = manager.parse(`| heading |\n| --- |\n| ${cell} |`);
    const markdown = serialize(document);

    expect(manager.parse(markdown)).toStrictEqual(document);
    expect(serialize(manager.parse(markdown))).toBe(markdown);
  });

  it("preserves non-breaking spaces at cell boundaries", () => {
    const document = {
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableHeader",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "heading" }],
                    },
                  ],
                },
              ],
            },
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "\u00a0value\u00a0" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const markdown = serialize(document);

    expect(markdown).toContain("&#160;value&#160;");
    expect(manager.parse(markdown)).toStrictEqual(document);
    expect(serialize(manager.parse(markdown))).toBe(markdown);
  });

  it("escapes literal pipes inside cells so they round trip", () => {
    const serialized = serialize({
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableHeader",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "h" }],
                    },
                  ],
                },
              ],
            },
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "a|b" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(serialized).toContain(String.raw`a\|b`);
    const reparsed = manager.parse(serialized);
    const row = reparsed.content?.[0]?.content?.[1];
    expect(row?.content?.length).toBe(1);
    const text = row?.content?.[0]?.content?.[0]?.content?.[0];
    expect(text && "text" in text && text.text).toBe("a|b");
  });

  it("joins multi-block cell content with <br>", () => {
    const serialized = serialize({
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableHeader",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "h" }],
                    },
                  ],
                },
              ],
            },
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "one" }],
                    },
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "two" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(serialized).toContain("one<br>two");
  });

  it("preserves column alignment in the delimiter row", () => {
    const doc = manager.parse("| l | r |\n| :--- | ---: |\n| 1 | 2 |");
    const serialized = serialize(doc);
    expect(serialized).toMatch(/\| *:-+ *\| *-+: *\|/u);
    const reparsed = manager.parse(serialized);
    const header = reparsed.content?.[0]?.content?.[0];
    expect(header?.content?.[0]?.attrs?.align).toBe("left");
    expect(header?.content?.[1]?.attrs?.align).toBe("right");
  });

  it("does not add a blank row when serializing a table without header cells", () => {
    const document = {
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "a" }],
                    },
                  ],
                },
              ],
            },
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "b" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const markdown = serialize(document);
    const reparsed = manager.parse(markdown);
    const table = reparsed.content?.[0];

    expect(table?.type).toBe("table");
    expect(table?.content).toHaveLength(2);
    const firstCellText = table?.content?.[0]?.content?.[0]?.content?.[0]
      ?.content?.[0]?.text;
    const secondCellText = table?.content?.[1]?.content?.[0]?.content?.[0]
      ?.content?.[0]?.text;
    expect(firstCellText).toBe("a");
    expect(secondCellText).toBe("b");
  });

  it("parses separator-heavy documents in bounded time", () => {
    // A regression test for the nested-lex blowup: each `x|y` + `| --- |`
    // unit used to re-lex the remaining document, giving superlinear growth.
    const unit = "# h`a|b`\n| --- | --- |\n";
    const doc = unit.repeat(320);
    // Measure parser work, excluding time the OS schedules other builds/tests.
    // Vitest isolates this file in its own process.
    const start = process.cpuUsage();
    manager.parse(doc);
    const elapsed = process.cpuUsage(start);
    expect((elapsed.user + elapsed.system) / 1000).toBeLessThan(5000);
  });
});
