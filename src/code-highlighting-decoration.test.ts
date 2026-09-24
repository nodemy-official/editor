import { describe, expect, it } from "vitest";

import {
  CodeHighlighting,
  getCodeHighlightDecorationAttributes,
} from "./code-highlighting-decoration";
import type { CodeHighlightingOptions } from "./code-highlighting-decoration";
import { defaultCodeHighlightThemes } from "./code-highlighting";
import type { CodeHighlightToken } from "./code-highlighting";

const token: CodeHighlightToken = {
  content: "const",
  offset: 0,
  color: "light-dark(#d73a49, #ff7b72)",
  lightColor: "#d73a49",
  darkColor: "#ff7b72",
};

const baseOptions: CodeHighlightingOptions = {
  themes: defaultCodeHighlightThemes,
  inlineColor: true,
  tokenColor: undefined,
  decorationClass: "editor__syntax-token",
  decorationAttributes: {},
};

describe("CodeHighlighting decoration options", () => {
  it("preserves the default class and inline theme color", () => {
    expect(getCodeHighlightDecorationAttributes(token, baseOptions)).toEqual({
      class: "editor__syntax-token",
      style: "color: light-dark(#d73a49, #ff7b72)",
    });
    expect(CodeHighlighting.options).toMatchObject({
      inlineColor: true,
      decorationClass: "editor__syntax-token",
    });
  });

  it("omits inline color and uses caller classes and attributes", () => {
    const attributes = getCodeHighlightDecorationAttributes(token, {
      ...baseOptions,
      inlineColor: false,
      decorationClass: "syntax-token",
      decorationAttributes: {
        "data-token-kind": "keyword",
      },
    });

    expect(attributes).toEqual({
      class: "syntax-token",
      "data-token-kind": "keyword",
    });
    expect(attributes).not.toHaveProperty("style");
  });

  it("accepts token-specific colors, classes, and additional styles", () => {
    const attributes = getCodeHighlightDecorationAttributes(token, {
      ...baseOptions,
      tokenColor: ({ lightColor }) => `var(--keyword-color, ${lightColor})`,
      decorationClass: ({ content }) => `syntax-token--${content}`,
      decorationAttributes: ({ content }) => ({
        class: "host-token",
        "data-token-content": content,
        style: "font-weight: 600",
      }),
    });

    expect(attributes).toEqual({
      class: "syntax-token--const host-token",
      "data-token-content": "const",
      style: "font-weight: 600; color: var(--keyword-color, #d73a49)",
    });
  });

  it("lets a token color callback omit inline color", () => {
    const attributes = getCodeHighlightDecorationAttributes(token, {
      ...baseOptions,
      tokenColor: () => undefined,
    });

    expect(attributes).toEqual({
      class: "editor__syntax-token",
    });
  });
});
