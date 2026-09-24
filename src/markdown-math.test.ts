import { MarkdownManager } from "@tiptap/markdown";
import { Marked, type marked } from "marked";
import { describe, expect, it } from "vitest";

import { createMarkdownEditorExtensions } from "./markdown-editor-extensions";
import { MarkdownInlineMath } from "./markdown-math";

function manager(math: boolean) {
  return new MarkdownManager({
    extensions: createMarkdownEditorExtensions({ math }),
    marked: new Marked() as unknown as typeof marked,
    markedOptions: { gfm: true },
  });
}

const withMath = manager(true);

function roundTrip(source: string) {
  return withMath.serialize(withMath.parse(source));
}

describe("Markdown math", () => {
  it("parses and serializes inline math without changing LaTeX", () => {
    const source = String.raw`面積は $\pi r^2$ です。`;
    const node = withMath.parse(source).content?.[0]?.content?.[1];
    expect(node?.type).toBe("inlineMath");
    expect(node?.attrs?.latex).toBe(String.raw`\pi r^2`);
    expect(roundTrip(source)).toBe(source);
    expect(roundTrip(roundTrip(source))).toBe(source);
  });

  it("parses and serializes a multiline display formula", () => {
    const source = String.raw`前文

$$
\begin{aligned}
a &= b \\
c &= d
\end{aligned}
$$

後文`;
    const document = withMath.parse(source);
    const formula = document.content?.find((node) => node.type === "blockMath");
    expect(formula?.attrs?.latex).toContain(String.raw`\begin{aligned}`);
    expect(roundTrip(source)).toBe(source);
    expect(roundTrip(roundTrip(source))).toBe(source);
  });

  it("allows longer fences and keeps shorter dollar lines inside the formula", () => {
    const source = "$$$\nx + y\n$$\nz\n$$$$";
    const node = withMath.parse(source).content?.[0];
    expect(node?.type).toBe("blockMath");
    expect(node?.attrs?.latex).toBe("x + y\n$$\nz");
    expect(roundTrip(source)).toBe(source);
  });

  it("grows the fence when an edited formula contains a dollar fence line", () => {
    const document = withMath.parse("$$\nx\n$$");
    const formula = document.content?.[0];
    if (!formula) throw new Error("expected math block");
    formula.attrs = { ...formula.attrs, latex: "a\n$$\nb" };
    const serialized = withMath.serialize(document);
    expect(serialized).toBe("$$$\na\n$$\nb\n$$$");
    expect(withMath.parse(serialized).content?.[0]?.attrs?.latex).toBe(
      "a\n$$\nb"
    );
  });

  it("recognizes fenced math in block quotes and list items", () => {
    const quoteSource = "> $$\n> x + y\n> $$";
    const quote = withMath.parse(quoteSource);
    expect(quote.content?.[0]?.content?.[0]?.type).toBe("blockMath");
    expect(JSON.stringify(withMath.parse(roundTrip(quoteSource)))).toContain(
      '"type":"blockMath"'
    );
    const listSource = "- $$\n  x + y\n  $$";
    const list = withMath.parse(listSource);
    expect(JSON.stringify(list)).toContain('"type":"blockMath"');
    expect(JSON.stringify(withMath.parse(roundTrip(listSource)))).toContain(
      '"type":"blockMath"'
    );
  });

  it("keeps formulas surrounded by formatting and other Markdown", () => {
    const source = String.raw`**重要** $x^2$ と [参照](https://example.com)`;
    expect(roundTrip(source)).toBe(source);
    expect(roundTrip(roundTrip(source))).toBe(source);
  });

  it("does not interpret currency as an inline formula", () => {
    const document = withMath.parse("価格は $5 and $6 です。");
    expect(JSON.stringify(document)).not.toContain('"type":"inlineMath"');
  });

  it("does not interpret code, escaped dollars, or unfinished formulas", () => {
    const source = [
      String.raw`\$x$ and $unfinished`,
      "",
      "`$x$`",
      "",
      "```text",
      "$x$",
      "$$",
      "```",
    ].join("\n");
    const document = withMath.parse(source);
    expect(JSON.stringify(document)).not.toContain('"type":"inlineMath"');
    expect(JSON.stringify(document)).not.toContain('"type":"blockMath"');
  });

  it("keeps malformed LaTeX as an editable math node", () => {
    const source = String.raw`壊れた式 $\frac{1$ を直す。`;
    expect(withMath.parse(source).content?.[0]?.content?.[1]?.type).toBe(
      "inlineMath"
    );
    expect(roundTrip(source)).toBe(source);
  });

  it("leaves dollar syntax literal when math is disabled", () => {
    const document = manager(false).parse("$x$\n\n$$\ny\n$$");
    expect(JSON.stringify(document)).not.toContain('"type":"inlineMath"');
    expect(JSON.stringify(document)).not.toContain('"type":"blockMath"');
  });

  it("lets a consumer register only the inline math extension", () => {
    const custom = new MarkdownManager({
      extensions: createMarkdownEditorExtensions({
        extensions: [MarkdownInlineMath],
      }),
      marked: new Marked() as unknown as typeof marked,
    });
    const document = custom.parse("$x$\n\n$$\ny\n$$");
    expect(document.content?.[0]?.content?.[0]?.type).toBe("inlineMath");
    expect(JSON.stringify(document)).not.toContain('"type":"blockMath"');
  });

  it("rejects duplicate math nodes with a clear error", () => {
    expect(() =>
      createMarkdownEditorExtensions({
        math: true,
        extensions: [MarkdownInlineMath],
      })
    ).toThrow(/custom inlineMath or blockMath/u);
  });
});
