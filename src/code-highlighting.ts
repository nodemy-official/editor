import type { HighlighterCore } from "shiki/core";
import type { ThemeInput, ThemeRegistrationAny } from "shiki/types";

import { getCodeLanguageInfo } from "./code-language-options";

// Grammars load on demand so the picker list in `codeLanguageOptions` never
// offers a language that cannot actually be highlighted. `text` is omitted on
// purpose: plain text needs no grammar and `highlightCode` skips it early.
const languages = {
  bash: async () => import("shiki/langs/bash.mjs"),
  c: async () => import("shiki/langs/c.mjs"),
  cpp: async () => import("shiki/langs/cpp.mjs"),
  csharp: async () => import("shiki/langs/csharp.mjs"),
  css: async () => import("shiki/langs/css.mjs"),
  dart: async () => import("shiki/langs/dart.mjs"),
  dockerfile: async () => import("shiki/langs/dockerfile.mjs"),
  go: async () => import("shiki/langs/go.mjs"),
  html: async () => import("shiki/langs/html.mjs"),
  java: async () => import("shiki/langs/java.mjs"),
  javascript: async () => import("shiki/langs/javascript.mjs"),
  json: async () => import("shiki/langs/json.mjs"),
  jsx: async () => import("shiki/langs/jsx.mjs"),
  kotlin: async () => import("shiki/langs/kotlin.mjs"),
  lua: async () => import("shiki/langs/lua.mjs"),
  markdown: async () => import("shiki/langs/markdown.mjs"),
  mdx: async () => import("shiki/langs/mdx.mjs"),
  php: async () => import("shiki/langs/php.mjs"),
  python: async () => import("shiki/langs/python.mjs"),
  r: async () => import("shiki/langs/r.mjs"),
  ruby: async () => import("shiki/langs/ruby.mjs"),
  rust: async () => import("shiki/langs/rust.mjs"),
  sql: async () => import("shiki/langs/sql.mjs"),
  swift: async () => import("shiki/langs/swift.mjs"),
  tsx: async () => import("shiki/langs/tsx.mjs"),
  typescript: async () => import("shiki/langs/typescript.mjs"),
  yaml: async () => import("shiki/langs/yaml.mjs"),
};
type CodeLanguage = keyof typeof languages;

/** A Shiki theme registration, module, or lazy theme loader. */
export type CodeHighlightTheme = ThemeInput;

/** Themes used for the editor's light and dark color-scheme variants. */
export interface CodeHighlightThemes {
  light: CodeHighlightTheme;
  dark: CodeHighlightTheme;
}

/** Default themes preserve the existing GitHub light/dark appearance. */
export const defaultCodeHighlightThemes: CodeHighlightThemes = {
  light: import("shiki/themes/github-light.mjs"),
  dark: import("shiki/themes/github-dark.mjs"),
};

export interface CodeHighlightToken {
  content: string;
  offset: number;
  /** A CSS color that switches between `lightColor` and `darkColor`. */
  color: string;
  lightColor: string;
  darkColor: string;
}

let highlighterPromise: Promise<HighlighterCore> | undefined;
const languagePromises = new Map<CodeLanguage, Promise<void>>();

async function getHighlighter() {
  highlighterPromise ??= Promise.all([
    import("shiki/core"),
    import("shiki/engine/javascript"),
  ])
    .then(
      async ([{ createHighlighterCore }, { createJavaScriptRegexEngine }]) =>
        createHighlighterCore({
          engine: createJavaScriptRegexEngine(),
          langs: [],
          themes: [
            defaultCodeHighlightThemes.dark,
            defaultCodeHighlightThemes.light,
          ],
        })
    )
    .catch((error: unknown) => {
      highlighterPromise = undefined;
      throw error;
    });
  return highlighterPromise;
}

/** A shared, lazy highlighter. Unrecognized languages and load failures stay readable. */
export async function highlightCode(
  source: string,
  language: string,
  themes: CodeHighlightThemes = defaultCodeHighlightThemes
): Promise<CodeHighlightToken[]> {
  const { id: lang } = getCodeLanguageInfo(language);
  if (!source || !lang || !Object.hasOwn(languages, lang)) {
    return [];
  }
  const supported = lang as CodeLanguage;

  try {
    const highlighter = await getHighlighter();
    let loading = languagePromises.get(supported);
    if (!loading) {
      // MDX embeds JSX, YAML frontmatter, and fenced code in the supported languages.
      const grammars =
        supported === "mdx" ? Object.values(languages) : [languages[supported]];
      loading = highlighter
        .loadLanguage(...grammars)
        .catch((error: unknown) => {
          languagePromises.delete(supported);
          throw error;
        });
      languagePromises.set(supported, loading);
    }
    await loading;

    const [lightTheme, darkTheme] = await Promise.all([
      resolveTheme(themes.light),
      resolveTheme(themes.dark),
    ]);
    await highlighter.loadTheme(lightTheme, darkTheme);

    // Token colors follow the host's color scheme, like the code surface itself.
    return highlighter
      .codeToTokensWithThemes(source, {
        lang: supported,
        themes: { dark: darkTheme, light: lightTheme },
      })
      .flat()
      .filter((token) => token.content.length > 0)
      .map((token) => {
        // GitHub Dark's original comment gray lacks contrast on our code surface.
        const dark =
          (themes === defaultCodeHighlightThemes &&
          token.variants.dark.color?.toLowerCase() === "#6a737d"
            ? "#8b949e"
            : token.variants.dark.color) ?? "currentColor";
        const light = token.variants.light.color ?? "currentColor";
        return {
          color: `light-dark(${light}, ${dark})`,
          content: token.content,
          darkColor: dark,
          lightColor: light,
          offset: token.offset,
        };
      });
  } catch {
    return [];
  }
}

async function resolveTheme(theme: CodeHighlightTheme) {
  const loaded = await (typeof theme === "function" ? theme() : theme);
  return (
    "default" in loaded ? loaded.default : loaded
  ) as ThemeRegistrationAny;
}
