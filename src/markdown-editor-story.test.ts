import type { Editor, JSONContent } from "@tiptap/core";
import { JSDOM } from "jsdom";
import { afterAll, afterEach, describe, expect, it } from "vitest";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
});
const domGlobalKeys = [
  "window",
  "document",
  "navigator",
  "Node",
  "HTMLElement",
  "customElements",
  "MutationObserver",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
] as const;
const originalDomGlobals = new Map(
  domGlobalKeys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)])
);

for (const key of [
  "window",
  "document",
  "navigator",
  "Node",
  "HTMLElement",
  "customElements",
  "MutationObserver",
  "getComputedStyle",
]) {
  Object.defineProperty(globalThis, key, {
    value:
      key === "getComputedStyle"
        ? dom.window.getComputedStyle.bind(dom.window)
        : dom.window[key as keyof typeof dom.window],
    configurable: true,
  });
}
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);

const { SyntaxOptions } = await import("../stories/markdown-editor.stories");

function createSyntaxOptionsStory() {
  const render = SyntaxOptions.render as (() => HTMLElement) | undefined;
  if (!render) {
    throw new Error("SyntaxOptions story must provide a render function");
  }
  const element = render();
  document.body.append(element);
  return element;
}

function editorFor(element: HTMLElement) {
  return (element as unknown as { editor: Editor }).editor;
}

function documentFeatures(document: JSONContent) {
  const nodeTypes: string[] = [];
  const markTypes: string[] = [];
  const visit = (node: JSONContent) => {
    if (node.type) nodeTypes.push(node.type);
    for (const mark of node.marks ?? []) markTypes.push(mark.type);
    node.content?.forEach(visit);
  };
  visit(document);
  return { nodeTypes, markTypes };
}

function setSyntaxOption(element: HTMLElement, key: string, enabled: boolean) {
  const checkbox = element.querySelector<HTMLInputElement>(
    `input[data-syntax="${key}"]`
  );
  if (!checkbox) throw new Error(`Missing ${key} syntax checkbox`);
  checkbox.checked = enabled;
  checkbox.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
}

describe("Markdown editor Storybook syntax options", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  afterAll(() => {
    dom.window.close();
    for (const key of domGlobalKeys) {
      const descriptor = originalDomGlobals.get(key);
      if (descriptor) {
        Object.defineProperty(globalThis, key, descriptor);
      } else {
        Reflect.deleteProperty(globalThis, key);
      }
    }
  });

  it("restores syntax after disabling and re-enabling it without an edit", () => {
    const story = createSyntaxOptionsStory();
    const source = editorFor(story).getMarkdown();

    setSyntaxOption(story, "gfm", false);
    setSyntaxOption(story, "footnotes", false);
    setSyntaxOption(story, "gfm", true);
    setSyntaxOption(story, "footnotes", true);

    const editor = editorFor(story);
    const features = documentFeatures(editor.getJSON());
    expect(features.nodeTypes).toEqual(
      expect.arrayContaining([
        "table",
        "taskList",
        "taskItem",
        "footnoteReference",
        "footnoteDefinition",
      ])
    );
    expect(features.markTypes).toContain("strike");
    expect(editor.getMarkdown()).toBe(source);
  });

  it("keeps edits made before a syntax toggle and disables the strike tool without GFM", () => {
    const story = createSyntaxOptionsStory();
    const editor = editorFor(story);
    let insertionPosition: number | undefined;
    editor.state.doc.descendants((node, position) => {
      if (
        node.type.name === "paragraph" &&
        node.textContent.includes("検索機能の更新")
      ) {
        insertionPosition = position + node.nodeSize - 1;
        return false;
      }
      return true;
    });
    expect(insertionPosition).toBeDefined();
    editor.commands.insertContentAt(insertionPosition!, "（編集済み）");
    expect(editorFor(story).getMarkdown()).toContain("（編集済み）");

    setSyntaxOption(story, "gfm", false);
    const strikeButton = story.querySelector<HTMLButtonElement>(
      '[data-command="strike"]'
    );
    expect(strikeButton?.disabled).toBe(true);
    expect(() => strikeButton?.click()).not.toThrow();

    setSyntaxOption(story, "gfm", true);
    expect(strikeButton?.disabled).toBe(false);
    const restored = editorFor(story);
    expect(restored.getMarkdown()).toContain("（編集済み）");
    const features = documentFeatures(restored.getJSON());
    expect(features.nodeTypes).toContain("taskItem");
    expect(features.markTypes).toContain("strike");
  });
});
