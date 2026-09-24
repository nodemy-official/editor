import { getSchema } from "@tiptap/core";
import { DOMParser, DOMSerializer } from "@tiptap/pm/model";
import { MarkdownManager } from "@tiptap/markdown";
import { StarterKit } from "@tiptap/starter-kit";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

import { textAttribute } from "./attributes";
import {
  getMarkdownReferenceLink,
  MarkdownReferenceDefinition,
  renderMarkdownLink,
  withMarkdownReferenceLinkAttributes,
} from "./markdown-reference-links";

function createExtensions() {
  const ReferenceAwareStarterKit = StarterKit.extend({
    addExtensions() {
      return (this.parent?.() ?? []).map((extension) => {
        if (extension.name !== "link") return extension;
        const link = extension.extend({
          parseMarkdown(token, helpers) {
            const children = helpers.parseInline(token.tokens ?? []);
            const attrs = {
              href: textAttribute(token.href),
              title: textAttribute(token.title) || null,
            };
            return children.map((child) => ({
              ...child,
              marks: [...(child.marks ?? []), { type: "link", attrs }],
            }));
          },
          renderMarkdown(node, helpers) {
            return renderMarkdownLink(node, helpers.renderChildren(node));
          },
        });
        return withMarkdownReferenceLinkAttributes(link);
      });
    },
  });

  return [ReferenceAwareStarterKit, MarkdownReferenceDefinition];
}

function createManager() {
  return new MarkdownManager({ extensions: createExtensions() });
}

function textLink(document: ReturnType<ReturnType<typeof createManager>["parse"]>) {
  const paragraph = document.content?.find((node) => node.type === "paragraph");
  return paragraph?.content?.find((node) => node.type === "text");
}

describe("Markdown reference links", () => {
  it("retains reference targets and normalizes implicit forms to explicit labels", () => {
    const manager = createManager();
    const source = [
      "[Full][docs] [Collapsed][] [Shortcut]",
      "",
      "[docs]: /guide \"Guide title\"",
      "[Collapsed]: /collapsed",
      "[Shortcut]: /shortcut",
    ].join("\n");
    const output = manager.serialize(manager.parse(source));

    expect(output).toContain("[Full][docs]");
    expect(output).toContain("[Collapsed][Collapsed]");
    expect(output).toContain("[Shortcut][Shortcut]");
    expect(output).toContain('[docs]: /guide "Guide title"');
    expect(output).toContain("[Collapsed]: /collapsed");
    expect(output).toContain("[Shortcut]: /shortcut");
    expect(manager.serialize(manager.parse(output))).toBe(output);
  });

  it("turns an edited link target or title into an inline link", () => {
    const manager = createManager();
    const document = manager.parse(
      '[Guide][docs]\n\n[docs]: /old "Old title"'
    );
    const link = textLink(document)?.marks?.find((mark) => mark.type === "link");
    expect(link?.attrs?.markdownReference).toBeDefined();
    if (!link?.attrs) throw new Error("Expected a link mark");
    link.attrs.href = "/new";
    link.attrs.title = "New title";

    const output = manager.serialize(document);
    expect(output).toContain('[Guide](/new "New title")');
    expect(output).toContain('[docs]: /old "Old title"');
    expect(manager.parse(output).content?.[0]?.content?.[0]?.marks?.[0]?.attrs)
      .toMatchObject({ href: "/new", title: "New title" });
  });

  it("applies edited definition destinations to references on the next parse", () => {
    const manager = createManager();
    const document = manager.parse(
      '[Guide][docs]\n\n[docs]: /old "Old title"'
    );
    const definition = document.content?.find(
      (node) => node.type === "markdownReferenceDefinition"
    );
    expect(definition?.attrs).toBeDefined();
    if (!definition?.attrs) throw new Error("Expected a reference definition");
    definition.attrs.href = "/new";
    definition.attrs.title = "New title";

    const output = manager.serialize(document);
    expect(output).toContain("[Guide][docs]");
    expect(output).toContain('[docs]: /new "New title"');
    const reparsed = manager.parse(output);
    expect(textLink(reparsed)?.marks?.find((mark) => mark.type === "link")?.attrs)
      .toMatchObject({ href: "/new", title: "New title" });
  });

  it("retains definition URL and title through HTML clipboard serialization", () => {
    const schema = getSchema(createExtensions());
    const document = new JSDOM().window.document;
    const content = schema.nodeFromJSON({
      type: "doc",
      content: [
        {
          type: "markdownReferenceDefinition",
          attrs: { label: "Docs", href: "/guide", title: "Guide title" },
        },
      ],
    });
    const root = document.createElement("div");
    root.append(
      DOMSerializer.fromSchema(schema).serializeFragment(content.content, {
        document,
      })
    );
    const parsed = DOMParser.fromSchema(schema).parse(root);

    expect(parsed.firstChild?.attrs).toMatchObject({
      label: "Docs",
      href: "/guide",
      title: "Guide title",
    });
  });

  it("falls back to an inline link after reference metadata is removed from a copy", () => {
    const manager = createManager();
    const document = manager.parse(
      '[Guide][docs]\n\n[docs]: /guide "Guide title"'
    );
    const link = textLink(document)?.marks?.find((mark) => mark.type === "link");
    if (!link?.attrs) throw new Error("Expected a link mark");
    link.attrs.markdownReference = null;

    expect(manager.serialize({
      type: "doc",
      content: [{ type: "paragraph", content: [textLink(document)!] }],
    })).toContain('[Guide](/guide "Guide title")');
  });

  it("recognizes reference syntax and excludes inline links", () => {
    expect(
      getMarkdownReferenceLink({
        type: "link",
        raw: "[Full][Docs]",
        href: "/guide",
        title: "Guide",
      })
    ).toMatchObject({
      kind: "full",
      label: "Docs",
      sourceText: "Full",
      href: "/guide",
      title: "Guide",
    });
    expect(
      getMarkdownReferenceLink({
        type: "link",
        raw: "[Docs][]",
        href: "/guide",
        title: null,
      })?.kind
    ).toBe("collapsed");
    expect(
      getMarkdownReferenceLink({
        type: "link",
        raw: "[Docs]",
        href: "/guide",
        title: null,
      })?.kind
    ).toBe("shortcut");
    expect(
      getMarkdownReferenceLink({
        type: "link",
        raw: "[Docs](/guide)",
        href: "/guide",
        title: null,
      })
    ).toBeNull();
  });
});
