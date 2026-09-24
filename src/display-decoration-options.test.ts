import { describe, expect, it } from "vitest";
import type { EditorView } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

import {
  EmojiDecorations,
  type EmojiDecorationRenderContext,
} from "./emoji-decorations";
import {
  TablePlaceholders,
  type TablePlaceholderRenderContext,
} from "./table-placeholders";

interface FakeElement {
  className: string;
  contentEditable: string;
  textContent: string | null;
  dataset: Record<string, string>;
}

function createDocumentStub(element: FakeElement): Document {
  return {
    createElement: () => element,
  } as unknown as Document;
}

const fakeView = {} as EditorView;

describe("table placeholder display options", () => {
  it("keeps the default empty-cell class and accessible placeholder", () => {
    const element: FakeElement = {
      className: "",
      contentEditable: "",
      textContent: "",
      dataset: {},
    };
    const options = TablePlaceholders.options;
    const rendered = options.renderPlaceholder({
      view: fakeView,
      document: createDocumentStub(element),
      cell: {} as ProseMirrorNode,
      position: 12,
      text: options.placeholderText,
      className: options.placeholderClassName,
    });

    expect(options.emptyCellClassName).toBe(
      "editor__empty-table-cell"
    );
    expect(element).toMatchObject({
      className: "editor__table-placeholder",
      contentEditable: "false",
      textContent: "…",
    });
    expect(rendered).toBe(element);
  });

  it("passes configured class names and text to a custom renderer", () => {
    let received: TablePlaceholderRenderContext | undefined;
    const customNode = {} as Node;
    const extension = TablePlaceholders.configure({
      emptyCellClassName: "app-empty-cell",
      placeholderClassName: "app-placeholder",
      placeholderText: "Add content",
      renderPlaceholder: (context) => {
        received = context;
        return customNode;
      },
    });
    const options = extension.options;
    const context: TablePlaceholderRenderContext = {
      view: fakeView,
      document: {} as Document,
      cell: {} as ProseMirrorNode,
      position: 23,
      text: options.placeholderText,
      className: options.placeholderClassName,
    };

    expect(options.emptyCellClassName).toBe("app-empty-cell");
    expect(options.renderPlaceholder(context)).toBe(customNode);
    expect(received).toMatchObject({
      position: 23,
      text: "Add content",
      className: "app-placeholder",
    });
  });
});

describe("emoji decoration display options", () => {
  it("keeps the default source hiding behavior and emoji rendering", () => {
    const element: FakeElement = {
      className: "",
      contentEditable: "",
      textContent: "",
      dataset: {},
    };
    const options = EmojiDecorations.options;
    const context: EmojiDecorationRenderContext = {
      view: fakeView,
      document: createDocumentStub(element),
      source: ":smile:",
      name: "smile",
      emoji: "😄",
      from: 4,
      to: 11,
      editing: false,
      className: options.emojiClassName,
    };
    const rendered = options.renderEmoji(context);

    const sourceStyle = options.sourceStyle;
    expect(typeof sourceStyle).toBe("function");
    if (typeof sourceStyle === "function") {
      expect(sourceStyle(context)).toBe("display: none");
      expect(sourceStyle({ ...context, editing: true })).toBeUndefined();
    }
    expect(element).toMatchObject({
      textContent: "😄",
      dataset: { editorEmoji: ":smile:" },
    });
    expect(rendered).toBe(element);
  });

  it("allows custom source styles and custom emoji DOM", () => {
    let received: EmojiDecorationRenderContext | undefined;
    const customNode = {} as Node;
    const extension = EmojiDecorations.configure({
      sourceClassName: "app-emoji-source",
      sourceStyle: () => undefined,
      emojiClassName: "app-emoji",
      renderEmoji: (context) => {
        received = context;
        return customNode;
      },
    });
    const options = extension.options;
    const context: EmojiDecorationRenderContext = {
      view: fakeView,
      document: {} as Document,
      source: ":heart:",
      name: "heart",
      emoji: "❤️",
      from: 1,
      to: 8,
      editing: false,
      className: options.emojiClassName,
    };

    expect(options.sourceClassName).toBe("app-emoji-source");
    const sourceStyle = options.sourceStyle;
    expect(typeof sourceStyle).toBe("function");
    if (typeof sourceStyle === "function") {
      expect(sourceStyle(context)).toBeUndefined();
    }
    expect(options.renderEmoji(context)).toBe(customNode);
    expect(received).toMatchObject({
      source: ":heart:",
      name: "heart",
      emoji: "❤️",
      className: "app-emoji",
    });
  });
});
