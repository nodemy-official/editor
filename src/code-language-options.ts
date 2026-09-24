const languageNames = {
  bash: "Bash",
  c: "C",
  cpp: "C++",
  csharp: "C#",
  css: "CSS",
  dart: "Dart",
  dockerfile: "Dockerfile",
  go: "Go",
  html: "HTML",
  java: "Java",
  javascript: "JavaScript",
  json: "JSON",
  jsx: "JavaScript (JSX)",
  kotlin: "Kotlin",
  lua: "Lua",
  markdown: "Markdown",
  php: "PHP",
  python: "Python",
  r: "R",
  ruby: "Ruby",
  rust: "Rust",
  sql: "SQL",
  swift: "Swift",
  text: "Plain Text",
  tsx: "TypeScript (TSX)",
  typescript: "TypeScript",
  yaml: "YAML",
} as const;

export type KnownCodeLanguage = keyof typeof languageNames;
// `string & {}` keeps literal-union autocomplete while accepting arbitrary strings.
// oxlint-disable-next-line typescript/ban-types
export type CodeLanguage = KnownCodeLanguage | (string & {});
export const codeLanguageOptions = Object.keys(
  languageNames
) as readonly KnownCodeLanguage[];

const languageAliases: Record<string, KnownCodeLanguage> = {
  "c#": "csharp",
  "c++": "cpp",
  cc: "cpp",
  cjs: "javascript",
  cs: "csharp",
  docker: "dockerfile",
  golang: "go",
  js: "javascript",
  kt: "kotlin",
  md: "markdown",
  mjs: "javascript",
  plain: "text",
  plaintext: "text",
  py: "python",
  rb: "ruby",
  rs: "rust",
  sh: "bash",
  shell: "bash",
  shellscript: "bash",
  ts: "typescript",
  txt: "text",
  yml: "yaml",
};

/** Resolve display metadata without rewriting the language stored in the document. */
export function getCodeLanguageInfo(language: string) {
  const normalized = language.trim().toLowerCase() || "text";
  const id = Object.hasOwn(languageAliases, normalized)
    ? languageAliases[normalized]
    : normalized;
  const name = Object.hasOwn(languageNames, id)
    ? languageNames[id as KnownCodeLanguage]
    : language.trim();
  return { id, name };
}
