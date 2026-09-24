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

`createMarkdownEditorExtensions` は CommonMark の編集に必要な Tiptap 拡張を返します。GFM の表・タスクリスト・取り消し線・URL の自動リンク、脚注、絵文字ショートコード表示も既定で有効です。

リンクには相対 URL と `http:`、`https:`、`mailto:`、`tel:` を使用できます。画像には相対 URL と `http:`、`https:` を使用できます。
Markdown の `<...>` 形式で指定した URL のパス中の空白も表示できます。
参照形式のリンクと定義（`[本文][id]` と `[id]: URL`）も保存時に保持します。省略形の `[id]` と `[id][]` は、本文を編集しても参照先が変わらないよう `[id][id]` に正規化されます。

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

### CommonMark 拡張構文の切り替え

`extendedSyntax` で CommonMark 以外の構文や表示機能を切り替えられます。`extendedSyntax` を省略するか `true` を渡すとすべて有効です。`false` は GFM、脚注、絵文字ショートコード表示をまとめて無効にし、CommonMark の構文だけを有効にします。

```ts
createMarkdownEditorExtensions({ extendedSyntax: false });

createMarkdownEditorExtensions({
  extendedSyntax: {
    gfm: false, // 表、タスクリスト、~~取り消し線~~、URL の自動リンクを無効化
    footnotes: false,
    emojiShortcodes: false, // :smile: の表示置換を無効化
  },
});
```

各項目は個別に `false` にできます。指定しなかった項目は有効です。`emojiShortcodes` はソース Markdown を変更せず、エディター上の表示だけを切り替えます。

### Markdown のコピー・貼り付け

選択した内容をコピーすると、クリップボードのプレーンテキストには Markdown を書き込みます。参照リンクだけをコピーする場合は定義が選択範囲外にあるため、URL を含むインラインリンクとしてコピーします。通常の編集状態に Markdown のプレーンテキストを貼り付けると、見出しや強調などを解析して挿入します。HTML を含むクリップボードは通常のリッチテキスト貼り付けとして扱い、コードブロックや Markdown ソースの編集中はテキストをそのまま貼り付けます。

この動作を無効にするには `markdownClipboard: false` を指定してください。

### 数式（オプトイン）

`math: true` を指定すると、`$...$` のインライン数式と、別行の `$$` で囲むブロック数式を有効にできます。既定では無効です。

```ts
import "katex/dist/katex.min.css";

const extensions = createMarkdownEditorExtensions({ math: true });
```

KaTeX の表示には CSS が必要です。利用側で KaTeX を依存関係に追加し、ブラウザー用のエントリーポイントから上記 stylesheet を読み込んでください。数式は Markdown のまま保存されます。

インライン数式またはブロック数式を選択すると、Markdown ソースを編集できます。フォーカスや選択を数式の外へ移すと、ソースを再解析して数式表示に戻ります。

Nodemy のように `extensions` へ独自の `inlineMath` 拡張を追加している場合は、`math: true` を同時に指定しないでください。同じ数式ノードが二重登録されます。

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
- `MarkdownClipboard`、`MarkdownReferenceDefinition`
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

Fallow で未使用コード、重複、複雑度を調べるには `pnpm analyze` を実行します。`pnpm analyze:changes` はベースブランチからの変更で新たに生じた指摘を検査し、Pull Request の CI でも実行されます。

Storybook（html-vite）で `stories` 配下の実例をブラウザー上で確認できます。

```sh
pnpm storybook
```

静的サイトをビルドするには次を実行します。

```sh
pnpm build-storybook
```

## License

MIT。著作権表記と条件は [LICENSE](./LICENSE) を参照してください。
