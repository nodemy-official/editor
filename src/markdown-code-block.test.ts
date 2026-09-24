import { MarkdownManager } from "@tiptap/markdown";
import { StarterKit } from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";

import { MarkdownCodeBlock } from "./markdown-code-block";

const manager = new MarkdownManager({
  extensions: [StarterKit.configure({ codeBlock: false }), MarkdownCodeBlock],
  markedOptions: { gfm: true },
});

function codeBlock(markdown: string) {
  const doc = manager.parse(markdown);
  const node = doc.content?.find((child) => child.type === "codeBlock");
  if (!node) {
    throw new Error(`Expected a code block in ${JSON.stringify(markdown)}`);
  }
  return node;
}

describe("MarkdownCodeBlock", () => {
  it("keeps the info string's language and trailing metadata", () => {
    const node = codeBlock('```tsx {1,3} caption="demo"\nconst a = 1;\n```');
    expect(node.attrs).toMatchObject({
      language: "tsx",
      codeMeta: '{1,3} caption="demo"',
    });
    expect(node.content?.[0]?.text).toBe("const a = 1;");
  });

  it("parses tilde fences and metadata-only info strings", () => {
    const node = codeBlock("~~~text linenos\nplain\n~~~");
    expect(node.attrs).toMatchObject({ language: "text", codeMeta: "linenos" });
    const bare = codeBlock("~~~\nplain\n~~~");
    expect(bare.attrs?.language).toBeNull();
    expect(bare.attrs?.codeMeta).toBeNull();
  });

  it("serializes language and metadata, defaulting a bare meta to text", () => {
    expect(
      manager.serialize({
        type: "doc",
        content: [
          {
            type: "codeBlock",
            attrs: { language: "js", codeMeta: "run" },
            content: [{ type: "text", text: "alert(1)" }],
          },
        ],
      })
    ).toContain("```js run\nalert(1)\n```");
    expect(
      manager.serialize({
        type: "doc",
        content: [
          {
            type: "codeBlock",
            attrs: { language: null, codeMeta: "highlight" },
            content: [{ type: "text", text: "x" }],
          },
        ],
      })
    ).toContain("```text highlight\nx\n```");
  });

  it("widens the fence past backtick runs and switches to tilde for backtick info", () => {
    const source = "const fence = ````;\n`` more";
    const output = manager.serialize({
      type: "doc",
      content: [
        {
          type: "codeBlock",
          attrs: { language: "js" },
          content: [{ type: "text", text: source }],
        },
      ],
    });
    expect(output).toContain(`\`\`\`\`\`js\n${source}\n\`\`\`\`\``);
    const tilde = manager.serialize({
      type: "doc",
      content: [
        {
          type: "codeBlock",
          attrs: { language: "js", codeMeta: "`inline`" },
          content: [{ type: "text", text: "x" }],
        },
      ],
    });
    expect(tilde).toContain("~~~js `inline`\nx\n~~~");
  });

  it("round-trips fence metadata through parse and serialize", () => {
    const markdown = "```python args=--fast\nprint('hi')\n```";
    expect(manager.serialize(manager.parse(markdown))).toContain(markdown);
  });

  it("flattens newlines injected into the info string attributes", () => {
    // A `\n` in `language` or `codeMeta` would otherwise break the fence line
    // and spill attribute text into the code content on reparse.
    const output = manager.serialize({
      type: "doc",
      content: [
        {
          type: "codeBlock",
          attrs: { language: "js\nx=1", codeMeta: "run\nmore" },
          content: [{ type: "text", text: "alert(1)" }],
        },
      ],
    });
    expect(output).toContain("```js x=1 run more\nalert(1)\n```");
    const reparsed = manager.parse(output).content?.[0];
    expect(reparsed?.attrs?.language).toBe("js");
    expect(reparsed?.content?.[0]?.text).toBe("alert(1)");
  });
});
