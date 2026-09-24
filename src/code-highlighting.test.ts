import { describe, expect, it, vi } from "vitest";

import { highlightCode as initialHighlightCode } from "./code-highlighting";

let highlightCode = initialHighlightCode;

describe("code highlighting", () => {
  // Exercise a fresh MDX load first, then reuse that module's grammars for the
  // remaining languages. Reset explicitly so shuffled/filtered runs stay valid.
  it("highlights MDX frontmatter, JSX expressions, and fenced code on a fresh load", async () => {
    vi.resetModules();
    ({ highlightCode } = await import("./code-highlighting"));
    const source = [
      "---",
      "enabled: true",
      "---",
      "# 日本語 🌸",
      "",
      '<Callout tone="info">{answer + 1}</Callout>',
      "",
      "```typescript",
      "const answer: number = 42;",
      "```",
      "",
    ].join("\n");
    const tokens = await highlightCode(source, "mdx");
    for (const content of [
      "true",
      "Callout",
      '"info"',
      "const",
      "number",
      "42",
    ]) {
      expect(tokens.some((token) => token.content === content)).toBeTruthy();
    }
    let end = 0;
    for (const token of tokens) {
      expect(source.slice(end, token.offset)).toMatch(/^[\r\n]*$/u);
      expect(
        source.slice(token.offset, token.offset + token.content.length)
      ).toBe(token.content);
      end = token.offset + token.content.length;
    }
    expect(source.slice(end)).toBe("\n");
  }, 15_000);

  it.each([
    ["javascript", 'const value = "hello"; // comment'],
    ["typescript", 'const value: string = "hello";'],
    ["python", 'def greet(name):\n    return "Hello " + name'],
    ["json", '{"value": true, "count": 42}'],
    ["sql", "SELECT name FROM users WHERE id = 42;"],
    ["html", '<img src="image.png">'],
    ["css", "body { color: red; }"],
    ["bash", 'echo "hello" # comment'],
    ["jsx", 'const element = <div title="hello" />;'],
    ["tsx", 'const element: JSX.Element = <div title="hello" />;'],
    ["yaml", "enabled: true\nname: hello"],
    ["rust", 'fn main() { let value = "hi"; }'],
    ["go", 'package main\nfunc main() { println("hi") }'],
    ["cpp", "#include <iostream>\nint main() { return 0; }"],
    ["markdown", "# Title\n\n**bold** text"],
    ["mdx", '# 見出し\n\n**強調** <Callout tone="info">{answer + 1}</Callout>'],
  ])("colors %s syntax with both host themes", async (language, source) => {
    const tokens = await highlightCode(source, language);
    expect(new Set(tokens.map((token) => token.color)).size).toBeGreaterThan(1);
    for (const token of tokens) {
      expect(token.color).toMatch(/^light-dark\(#[\da-f]{6}, #[\da-f]{6}\)$/iu);
      expect(
        source.slice(token.offset, token.offset + token.content.length)
      ).toBe(token.content);
    }
  });

  it("uses caller-provided Shiki themes for each color scheme", async () => {
    const source = "const value = true;";
    const defaults = await highlightCode(source, "javascript");
    const custom = await highlightCode(source, "javascript", {
      light: import("shiki/themes/github-dark.mjs"),
      dark: import("shiki/themes/github-light.mjs"),
    });
    const defaultKeyword = defaults.find((token) => token.content === "const");
    const customKeyword = custom.find((token) => token.content === "const");

    expect(defaultKeyword).toBeDefined();
    expect(customKeyword).toBeDefined();
    expect(customKeyword?.lightColor).toBe(defaultKeyword?.darkColor);
    expect(customKeyword?.darkColor).toBe(defaultKeyword?.lightColor);
  });

  it("resolves language aliases and ignores surrounding whitespace and case", async () => {
    const source = "const value = 42;";
    await expect(highlightCode(source, " JS ")).resolves.toStrictEqual(
      await highlightCode(source, "javascript")
    );
  });

  it.each([
    "",
    "text",
    "plaintext",
    "unknown-language",
    "__proto__",
    "constructor",
  ])("keeps %s as plain text", async (language) => {
    await expect(
      highlightCode("const value = 42;", language)
    ).resolves.toStrictEqual([]);
  });

  it("keeps offsets aligned across CRLF, tabs, Unicode, blank lines, and trailing newlines", async () => {
    const source =
      '\tconst message = "日本語 🌸";\r\n\r\nconsole.log(message);\r\n';
    const tokens = await highlightCode(source, "javascript");
    expect(tokens.length).toBeGreaterThan(1);
    let end = 0;
    for (const token of tokens) {
      expect(source.slice(end, token.offset)).toMatch(/^[\r\n]*$/u);
      expect(
        source.slice(token.offset, token.offset + token.content.length)
      ).toBe(token.content);
      end = token.offset + token.content.length;
    }
    expect(source.slice(end)).toBe("\r\n");
  });
});
