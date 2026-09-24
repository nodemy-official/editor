import { MarkdownManager } from "@tiptap/markdown";
import { describe, expect, it } from "vitest";

import { createMarkdownEditorExtensions } from "./markdown-editor-extensions";

const manager = new MarkdownManager({
  extensions: createMarkdownEditorExtensions(),
  markedOptions: { gfm: true },
});

function roundTrip(markdown: string) {
  return manager.serialize(manager.parse(markdown));
}

describe("Markdown round trips", () => {
  it("keeps footnote references and definitions", () => {
    const markdown = "文[^a]です。\n\n[^a]: 脚注の本文";
    expect(roundTrip(markdown)).toContain("文[^a]です。");
    expect(roundTrip(markdown)).toContain("[^a]: 脚注の本文");
  });

  it("emits stable markdown when marks enclose atom inline nodes", () => {
    // Leaf nodes retain links, while text formatting stays on adjacent prose.
    // Neither case should introduce dangling delimiters.
    expect(roundTrip("**太字[^b]**")).toContain("**太字**[^b]");
    expect(roundTrip("*em[^b]*")).toContain("*em*[^b]");
    expect(roundTrip("~~del[^b]~~")).toContain("~~del~~[^b]");
    expect(roundTrip("[x[^b]](https://example.com)")).toContain(
      "[x](https://example.com)[[^b]](https://example.com)"
    );
    expect(roundTrip("**a ![i](https://example.com/i.png) b**")).toContain(
      "**a** ![i](https://example.com/i.png) **b**"
    );
    // The stabilized output parses back without further drift.
    expect(roundTrip(roundTrip("**太字[^b]**"))).toBe(
      roundTrip("**太字[^b]**")
    );
  });

  it("keeps unsafe link hrefs in the document model", () => {
    const doc = manager.parse("[x](javascript:alert(1))");
    const paragraph = doc.content?.[0];
    const link = paragraph?.content?.[0]?.marks?.find(
      (mark) => mark.type === "link"
    );
    expect(link?.attrs?.href).toBe("javascript:alert(1)");
    expect(roundTrip("[x](javascript:alert(1))")).toContain(
      "[x](<javascript:alert(1)>)"
    );
  });

  it("keeps unsafe image sources in the document model", () => {
    expect(roundTrip("![x](javascript:evil)")).toContain(
      "![x](javascript:evil)"
    );
  });

  it("serializes multi-paragraph footnote definitions", () => {
    // The continuation indent must survive the blank line between paragraphs;
    // joining them would silently merge the definition body. Blank lines stay
    // empty — indenting them would leave trailing whitespace in the output.
    const output = roundTrip("[^n]: first\n\n    second");
    expect(output).toBe("[^n]: first\n\n    second");
    const reparsed = manager.parse(output);
    const definition = reparsed.content?.find(
      (node) => node.type === "footnoteDefinition"
    );
    expect(definition?.content).toHaveLength(2);
    expect(roundTrip(output)).toBe(output);
  });

  it("serializes an empty footnote definition without a trailing space", () => {
    expect(roundTrip("[^a]:")).toBe("[^a]:");
    expect(roundTrip("[^a]: ")).toBe("[^a]:");
  });

  it("keeps link marks around images", () => {
    // The serializer only writes mark delimiters around text nodes, so the
    // image node emits its own `[…](href)` wrapper for a `link` mark.
    expect(roundTrip("[![i](s)](h)")).toBe("[![i](s)](h)");
    expect(roundTrip("[a![i](s)b](u)")).toBe("[a](u)[![i](s)](u)[b](u)");
    const wrapped = roundTrip("x [![i](s)](u) y");
    expect(wrapped).toBe("x [![i](s)](u) y");
    expect(roundTrip(wrapped)).toBe(wrapped);
    expect(roundTrip(roundTrip("[![i](s)](h)"))).toBe("[![i](s)](h)");
  });

  it("parses footnote definitions with up to three leading spaces", () => {
    expect(roundTrip("   [^a]: indented")).toBe("[^a]: indented");
    expect(roundTrip(" [^a]: one")).toBe("[^a]: one");
    expect(roundTrip("text\n   [^a]: two")).toBe("text\n\n[^a]: two");
    // Four leading spaces remain an indented code block.
    expect(manager.parse("    [^a]: code").content?.[0]?.type).toBe(
      "codeBlock"
    );
  });

  it("serializes tricky link destinations in angle brackets", () => {
    // Whitespace or parens inside `(href)` break reparsing, so the serializer
    // emits `<href>` and escapes brackets and backslashes within it.
    const spaced = roundTrip("[x](<https://e.com/a b>)");
    expect(spaced).toBe("[x](<https://e.com/a b>)");
    expect(roundTrip(spaced)).toBe(spaced);
    const escaped = roundTrip(String.raw`[x](foo\)bar)`);
    expect(escaped).toBe("[x](<foo)bar>)");
    expect(roundTrip(escaped)).toBe(escaped);
    const titled = roundTrip(String.raw`[x](u "a \"b\"")`);
    expect(roundTrip(titled)).toBe(titled);
  });

  it("keeps table-like text inside a blockquote intact", () => {
    // The table extension's tokenizer `start` must not fire where `tokenize`
    // would decline; a false positive makes marked split the preceding text
    // into single-character tokens, which then drift across round trips.
    const markdown = "> quo&lt;|\n> |---|---|\n> | 1 | 2 |";
    const output = roundTrip(markdown);
    expect(output).toContain("quo&lt;|");
    expect(output).not.toContain("> q\n> u");
    expect(roundTrip(output)).toBe(output);
    expect(roundTrip(roundTrip(output))).toBe(output);
  });

  it("keeps backticks inside code spans", () => {
    // The stock code mark emits single-backtick delimiters, which merge with
    // backticks inside the span and drop content on reparse.
    const fenced = roundTrip("`` `x` ``");
    expect(fenced).toBe("`` `x` ``");
    expect(roundTrip(fenced)).toBe(fenced);
    expect(roundTrip("``` `` ```")).toBe("``` `` ```");
    expect(roundTrip("`x`")).toBe("`x`");
    // CommonMark strips one boundary space pair, so a leading and trailing
    // space inside a span only survives with extra padding.
    const spaced = roundTrip("`  x  `");
    expect(manager.parse(spaced).content?.[0]?.content?.[0]?.text).toBe(" x ");
    expect(spaced).toBe("`  x  `");
    expect(roundTrip(spaced)).toBe(spaced);
  });

  it("keeps link marks around code spans with backticks", () => {
    const linked = roundTrip("[`` `x` ``](u)");
    expect(linked).toBe("[`` `x` ``](u)");
    expect(roundTrip(linked)).toBe(linked);
    expect(roundTrip("[a `c` b](u)")).toBe("[a `c` b](u)");
  });

  it("keeps emphasis marks around code spans with backticks", () => {
    for (const markdown of [
      "**`` `x` ``**",
      "*`` `x` ``*",
      "~~`` `x` ``~~",
      "***`` `x` ``***",
    ]) {
      expect(roundTrip(markdown)).toBe(markdown);
      expect(roundTrip(roundTrip(markdown))).toBe(markdown);
    }
  });

  it("serializes large code spans without exhausting the argument stack", () => {
    const text = "a`".repeat(150_000);
    const output = manager.serialize({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text, marks: [{ type: "code" }] }],
        },
      ],
    });
    // Keep all 150,000 delimiter runs to exercise the serializer's argument-stack
    // boundary. Check the complete output directly: parsing this adversarial
    // span spends tens of seconds in marked's emphasis masking. The surrounding
    // round-trip cases cover code-span parsing, padding and nested marks.
    expect(output).toBe(`\`\` ${text} \`\``);
  });

  it("keeps whitespace-only code spans", () => {
    // The upstream text serializer drops whitespace-only runs entirely.
    expect(roundTrip("` `")).toBe("` `");
    expect(roundTrip("`  `")).toBe("`  `");
    expect(roundTrip(roundTrip("` `"))).toBe("` `");
  });

  it("keeps significant spaces at the edge of code spans", () => {
    // The stock code mark pushes edge whitespace outside the span or drops
    // it; padding the fenced content keeps the space inside the mark.
    const cases: [string, string, string][] = [
      ["`a `", "` a  `", "a "],
      ["` a`", "`  a `", " a"],
      ["`  a `", "`  a `", " a"],
      ["`a  `", "` a   `", "a  "],
    ];
    for (const [input, output, text] of cases) {
      expect(roundTrip(input)).toBe(output);
      expect(manager.parse(output).content?.[0]?.content?.[0]?.text).toBe(text);
      expect(roundTrip(output)).toBe(output);
    }
    // Edge spaces survive alongside other marks.
    expect(roundTrip("**`a `**")).toBe("**` a  `**");
    expect(roundTrip("[`a `](u)")).toBe("[` a  `](u)");
  });

  it("keeps escaped footnote syntax as literal text", () => {
    // `\[^a]:` must not be promoted to a footnote definition.
    const escaped = roundTrip(String.raw`\[^a]: escaped`);
    expect(escaped).not.toContain("footnoteDefinition");
    const reparsed = manager.parse(escaped);
    expect(
      reparsed.content?.every((node) => node.type !== "footnoteDefinition")
    ).toBeTruthy();
    expect(escaped).toContain(String.raw`[^a\]: escaped`);
    expect(roundTrip(escaped)).toBe(escaped);
    // A reference followed by an escaped colon must not become a definition.
    const colon = roundTrip(String.raw`[^a]\: notdef`);
    expect(colon).toBe(String.raw`[^a]\: notdef`);
    expect(roundTrip(colon)).toBe(colon);
  });
});

describe("serialization boundary regressions", () => {
  it.each([
    "[a![i](s)](u)",
    "[a`` `x` ``](u)",
    "[a[^n]](u)",
    "[[^n]](u)",
    "[a[^n]b](u)",
    "| head |\n| --- |\n| `` `x` `` |",
    "| head |\n| --- |\n| ` a  ` |",
    "[x](a&amp;copy;)",
    "![a&amp;copy;](u)",
    '[x](u "a&amp;copy;")',
  ])("preserves parsed content: %s", (markdown) => {
    const before = manager.parse(markdown);
    expect(manager.parse(manager.serialize(before))).toStrictEqual(before);
  });
});
