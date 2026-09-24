# @nodemy-official/editor

Tiptap を使った headless な Markdown 編集拡張です。入力中も Markdown を描画し、カーソル位置の構文を編集できる形で表示します。

React コンポーネントや CSS は含みません。拡張が出力する CSS class は利用側でスタイルできますが、スタイルシート自体は同梱していません。

## インストール

```sh
pnpm add @nodemy-official/editor
```

## 使い方

```ts
import { Editor } from "@tiptap/core";
import { createMarkdownEditorExtensions } from "@nodemy-official/editor";

const editor = new Editor({
  extensions: createMarkdownEditorExtensions({ placeholder: "ここに入力" }),
  contentType: "markdown",
  content: "# Hello\n\nMarkdown を編集します。",
});
```

`createMarkdownEditorExtensions` は標準の Markdown、表、タスクリスト、脚注、絵文字、コードハイライト、カーソル位置での Markdown 構文表示などに使う Tiptap 拡張を返します。

```ts
createMarkdownEditorExtensions({
  extensions: [/* 利用側の Tiptap 拡張 */],
  codeBlock: false, // false でコードブロックを無効化
  placeholder: "入力してください",
  taskItemLabel: (text) => `タスク: ${text}`,
  footnoteLabel: (label) => `脚注 ${label} を表示`,
  history: false, // undo/redo を利用側で管理する場合
});
```

### 表示のカスタマイズ

表示用の CSS は利用側で指定します。既定のクラス名も変更でき、表のヒントや絵文字の DOM は描画関数で差し替えられます。

```ts
createMarkdownEditorExtensions({
  tablePlaceholders: {
    emptyCellClassName: "my-empty-cell",
    placeholderClassName: "my-table-hint",
    placeholderText: "入力してください",
    renderPlaceholder: ({ document, text, className }) => {
      const element = document.createElement("span");
      element.className = className;
      element.textContent = text;
      return element;
    },
  },
  emojiDecorations: {
    sourceClassName: "my-emoji-source",
    emojiClassName: "my-emoji",
    // 元の :name: を CSS で制御する場合、inline style を出さない
    sourceStyle: () => undefined,
    renderEmoji: ({ document, emoji }) => document.createTextNode(emoji),
  },
  markdownReveal: {
    revealedClass: "my-revealed-markdown",
    sourceClass: "my-markdown-source",
  },
  footnoteReference: {
    HTMLAttributes: { class: "my-footnote-marker" },
    renderLabel: (label) => `[${label}]`,
  },
  footnoteDefinition: {
    HTMLAttributes: { class: "my-footnote-definition" },
  },
  codeHighlighting: {
    // Shiki の ThemeInput を light/dark それぞれに指定できる
    themes: {
      light: import("shiki/themes/github-light.mjs"),
      dark: import("shiki/themes/github-dark.mjs"),
    },
    inlineColor: false, // 色は利用側の CSS で指定する
    decorationClass: "my-syntax-token",
    decorationAttributes: { "data-my-token": "true" },
  },
});
```

`codeHighlighting.tokenColor` には色、`null`、またはトークンを受け取る関数を渡せます。関数では `lightColor` と `darkColor` も参照できます。装飾クラスと追加属性もトークンごとの関数で指定できます。

`tablePlaceholders`、`emojiDecorations`、`codeHighlighting` は `false` にすると無効化できます。個々の拡張を直接 `configure()` して使うこともできます。

## 主な exports

- `createMarkdownEditorExtensions(options)` と `MarkdownEditorExtensionsOptions`
- `MarkdownCodeBlock`、`MarkdownCodeSpan`、`MarkdownReveal`
- `getMarkdownRevealState`、`prepareMarkdownCommand`、`withMarkdownReveal`
- `FootnoteDefinition`、`FootnoteReference`、`EmojiDecorations`、`TablePlaceholders`
- `CodeHighlighting`、`highlightCode`、コード言語メタデータ
- `textAttribute`、`isSafeMarkdownLink`

## 開発

Node.js 22 以上と pnpm を使います。

```sh
pnpm install
pnpm check
pnpm pack:dry-run
```

## License

MIT。著作権表記と条件は [LICENSE](./LICENSE) を参照してください。
