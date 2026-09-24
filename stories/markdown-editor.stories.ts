import { Editor } from "@tiptap/core";
import type { MarkdownEditorExtensionsOptions } from "../src/markdown-editor-extensions";
import { createMarkdownEditorExtensions } from "../src/markdown-editor-extensions";
import type { Meta, StoryObj } from "@storybook/html-vite";

import "katex/dist/katex.min.css";
import "./markdown-editor.css";

type SyntaxOptions = NonNullable<MarkdownEditorExtensionsOptions["extendedSyntax"]>;

function supportsGfm(syntaxOptions: SyntaxOptions) {
  return (
    syntaxOptions !== false &&
    (typeof syntaxOptions !== "object" || syntaxOptions.gfm !== false)
  );
}

interface DemoConfig {
  title: string;
  description: string;
  markdown: string;
  math?: MarkdownEditorExtensionsOptions["math"];
  syntaxOptions?: SyntaxOptions;
  showSyntaxOptions?: boolean;
  themeClass?: string;
  extensionOptions?: Omit<MarkdownEditorExtensionsOptions, "extendedSyntax">;
}

const extendedMarkdown = [
  "# 今週の対応状況",
  "",
  "検索機能の更新を行いました。完了した項目は **確認済み**、残っている項目は ~~保留~~ としています。",
  "",
  "| 作業 | 担当 | 状況 |",
  "| --- | --- | --- |",
  "| 検索結果の日付表示 | 佐藤 | 完了 |",
  "| ヘルプ記事の更新 | 鈴木 | 対応中 |",
  "",
  "- [x] 検索結果の日付表示",
  "- [ ] ヘルプ記事の更新",
  "",
  "検索条件を保存できるようになりました :white_check_mark:。詳しくは https://example.com/changelog を確認してください。[^note]",
  "",
  "[^note]: 対応状況は 9 月 24 日時点の内容です。",
].join("\n");

const config = {
  title: "Markdown Editor",
  parameters: { layout: "padded" },
} satisfies Meta;

export default config;
type Story = StoryObj<typeof config>;

/** Basic Editor と構文設定 story が共有する、編集可能なプレビュー要素。 */
class MarkdownEditorStoryElement extends HTMLElement {
  private editor: Editor | undefined;
  private editorHost: HTMLElement | undefined;
  private markdownOutput: HTMLElement | undefined;
  private initialConfig: DemoConfig | undefined;
  private currentMarkdown = "";

  set storyConfig(value: DemoConfig) {
    this.initialConfig = value;
    this.currentMarkdown = value.markdown;
    if (this.isConnected) {
      this.mount();
    }
  }

  connectedCallback() {
    this.mount();
  }

  disconnectedCallback() {
    this.destroyEditor();
  }

  private mount() {
    const storyConfig = this.initialConfig;
    if (!storyConfig) {
      return;
    }

    this.destroyEditor();
    this.replaceChildren();
    this.className = ["markdown-editor-story", storyConfig.themeClass]
      .filter(Boolean)
      .join(" ");

    const header = document.createElement("header");
    header.className = "markdown-editor-story__header";
    const heading = document.createElement("h1");
    heading.textContent = storyConfig.title;
    const description = document.createElement("p");
    description.textContent = storyConfig.description;
    header.append(heading, description);

    const workspace = document.createElement("section");
    workspace.className = "markdown-editor-story__workspace";

    if (storyConfig.showSyntaxOptions) {
      workspace.append(this.createSyntaxOptions(storyConfig));
    }

    const toolbar = document.createElement("div");
    toolbar.className = "markdown-editor-story__toolbar";
    toolbar.setAttribute("role", "toolbar");
    toolbar.setAttribute("aria-label", "Markdown 書式");

    const editorPanel = document.createElement("div");
    editorPanel.className = "markdown-editor-story__editor-panel";
    this.editorHost = document.createElement("div");
    this.editorHost.className = "markdown-editor-story__editor";
    editorPanel.append(this.editorHost);

    const output = document.createElement("details");
    output.className = "markdown-editor-story__output";
    const summary = document.createElement("summary");
    summary.textContent = "Markdown 出力";
    this.markdownOutput = document.createElement("pre");
    output.append(summary, this.markdownOutput);

    workspace.append(toolbar, editorPanel, output);
    this.append(header);
    this.append(workspace);
    this.addToolbarButtons(toolbar);
    this.mountEditor(storyConfig.syntaxOptions ?? true);
  }

  private createSyntaxOptions(storyConfig: DemoConfig) {
    const fieldset = document.createElement("fieldset");
    fieldset.className = "markdown-editor-story__syntax-options";
    const legend = document.createElement("legend");
    legend.textContent = "有効にする拡張構文";
    fieldset.append(legend);

    const initial = storyConfig.syntaxOptions;
    const values =
      initial === false
        ? { gfm: false, footnotes: false, emojiShortcodes: false }
        : {
            gfm: typeof initial === "object" ? initial.gfm !== false : true,
            footnotes:
              typeof initial === "object" ? initial.footnotes !== false : true,
            emojiShortcodes:
              typeof initial === "object"
                ? initial.emojiShortcodes !== false
                : true,
          };

    for (const [key, label] of [
      ["gfm", "GFM（表・タスク・取り消し線・URL）"],
      ["footnotes", "脚注"],
      ["emojiShortcodes", "絵文字ショートコード"],
    ] as const) {
      const item = document.createElement("label");
      item.className = "markdown-editor-story__option";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = values[key];
      checkbox.addEventListener("change", () => {
        const nextOptions = {
          gfm: fieldset.querySelector<HTMLInputElement>('input[data-syntax="gfm"]')!.checked,
          footnotes: fieldset.querySelector<HTMLInputElement>(
            'input[data-syntax="footnotes"]'
          )!.checked,
          emojiShortcodes: fieldset.querySelector<HTMLInputElement>(
            'input[data-syntax="emojiShortcodes"]'
          )!.checked,
        };
        this.mountEditor(nextOptions);
      });
      checkbox.dataset.syntax = key;
      const text = document.createElement("span");
      text.textContent = label;
      item.append(checkbox, text);
      fieldset.append(item);
    }

    return fieldset;
  }

  private addToolbarButtons(toolbar: HTMLElement) {
    const actions: Array<{
      label: string;
      title: string;
      command?: string;
      run: (editor: Editor) => void;
    }> = [
      { label: "B", title: "太字", run: (editor) => editor.chain().focus().toggleBold().run() },
      { label: "I", title: "斜体", run: (editor) => editor.chain().focus().toggleItalic().run() },
      { label: "S", title: "取り消し線", command: "strike", run: (editor) => editor.chain().focus().toggleStrike().run() },
      { label: "H2", title: "見出し 2", run: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run() },
      { label: "引用", title: "引用", run: (editor) => editor.chain().focus().toggleBlockquote().run() },
      { label: "リスト", title: "箇条書き", run: (editor) => editor.chain().focus().toggleBulletList().run() },
    ];

    for (const action of actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "markdown-editor-story__tool";
      button.title = action.title;
      button.setAttribute("aria-label", action.title);
      button.textContent = action.label;
      if ("command" in action) {
        button.dataset.command = action.command;
      }
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", () => {
        if (this.editor) {
          action.run(this.editor);
          this.editor.commands.focus();
        }
      });
      toolbar.append(button);
    }
  }

  private mountEditor(syntaxOptions: SyntaxOptions) {
    const host = this.editorHost;
    if (!host) {
      return;
    }

    const strikeButton = this.querySelector<HTMLButtonElement>(
      '[data-command="strike"]'
    );
    if (strikeButton) {
      strikeButton.disabled = !supportsGfm(syntaxOptions);
    }

    this.destroyEditor();
    host.replaceChildren();
    this.editor = new Editor({
      element: host,
      extensions: createMarkdownEditorExtensions({
        ...this.initialConfig?.extensionOptions,
        extendedSyntax: syntaxOptions,
        math:
          this.initialConfig?.math ?? this.initialConfig?.extensionOptions?.math,
        placeholder:
          this.initialConfig?.extensionOptions?.placeholder ??
          "ここに Markdown を入力…",
      }),
      contentType: "markdown",
      content: this.currentMarkdown,
    });

    const updateOutput = () => {
      this.currentMarkdown = this.editor?.getMarkdown() ?? "";
      if (this.markdownOutput) {
        this.markdownOutput.textContent = this.currentMarkdown;
      }
    };
    this.editor.on("update", updateOutput);
    if (this.markdownOutput) {
      this.markdownOutput.textContent = this.currentMarkdown;
    }
  }

  private destroyEditor() {
    this.editor?.destroy();
    this.editor = undefined;
  }
}

const elementName = "markdown-editor-story";
if (!customElements.get(elementName)) {
  customElements.define(elementName, MarkdownEditorStoryElement);
}

function createEditorStory(storyConfig: DemoConfig) {
  const element = document.createElement(elementName) as MarkdownEditorStoryElement;
  element.storyConfig = storyConfig;
  return element;
}

export const BasicEditing: Story = {
  name: "基本編集",
  render: () =>
    createEditorStory({
      title: "プロジェクトの進捗",
      description:
        "今週の更新内容をまとめています。本文をクリックして編集し、ツールバーから書式を変更できます。",
      markdown: [
        "# 今週の更新",
        "",
        "検索画面の改善を行いました。**変更点**や *補足*、`設定ファイル` などの書式を編集できます。",
        "",
        "## 対応したこと",
        "",
        "- 検索結果に更新日を表示",
        "- [x] キーボード操作を改善",
        "- [ ] ヘルプ記事を更新",
        "",
        "次回の予定は [プロジェクトのページ](https://example.com/project) にまとめています。",
      ].join("\n"),
    }),
};

export const ExtendedSyntax: Story = {
  name: "拡張構文",
  render: () =>
    createEditorStory({
      title: "スプリントの振り返り",
      description:
        "作業の進捗を記録した文書です。表、タスクリスト、脚注、絵文字などを編集できます。",
      markdown: [
        "# 第 24 スプリント",
        "",
        "## 作業状況",
        "",
        "| 作業 | 担当 | 状況 |",
        "| --- | --- | --- |",
        "| 検索画面の改善 | 佐藤 | 完了 |",
        "| ヘルプ記事の更新 | 鈴木 | 対応中 |",
        "",
        "- [x] 検索結果の日付表示",
        "- [ ] キーボード操作の確認",
        "",
        "検索条件を保存できるようになりました :white_check_mark:。詳細は [変更履歴](https://example.com/changelog) を確認してください。[^sprint]",
        "",
        "[^sprint]: 対応状況は 9 月 24 日時点の内容です。",
      ].join("\n"),
    }),
};

export const Math: Story = {
  name: "数式（オプトイン）",
  render: () =>
    createEditorStory({
      title: "積分のメモ",
      description:
        "数式をクリックして編集できます。カーソルを別の場所へ移すと、数式として表示されます。",
      math: true,
      markdown: [
        "0 から 1 まで $x^2$ を積分すると、次の式になります。",
        "",
        "$$",
        String.raw`\int_0^1 x^2 \, dx = \frac{1}{3}`,
        "$$",
      ].join("\n"),
    }),
};

export const FullyCustomizedDesign: Story = {
  name: "デザインを全面カスタマイズ",
  parameters: {
    docs: {
      description: {
        story:
          "この例では CSS と拡張オプションを変更し、表の空欄ヒント、絵文字、脚注、コード、数式、Markdown 構文の表示を調整しています。本文を編集して、それぞれの表示を確認できます。",
      },
    },
  },
  render: () =>
    createEditorStory({
      title: "リリースノート",
      description:
        "バージョン 2.8.0 の変更内容をまとめています。本文を編集して、書式や各要素の表示を確認できます。",
      themeClass: "markdown-editor-story--workspace",
      math: {
        HTMLAttributes: {
          class: "release-math",
          "data-math-style": "report",
        },
      },
      extensionOptions: {
        tablePlaceholders: {
          emptyCellClassName: "release-empty-cell",
          placeholderClassName: "release-table-hint",
          placeholderText: "入力",
          renderPlaceholder: ({ document, className, text }) => {
            const placeholder = document.createElement("span");
            placeholder.className = className;
            placeholder.setAttribute("aria-hidden", "true");
            placeholder.textContent = `＋ ${text}`;
            return placeholder;
          },
        },
        emojiDecorations: {
          sourceClassName: "release-emoji-source",
          emojiClassName: "release-emoji",
          renderEmoji: ({ document, name, emoji, className }) => {
            const element = document.createElement("span");
            element.className = className;
            element.setAttribute("role", "img");
            element.setAttribute("aria-label", name.replaceAll("-", " "));
            element.textContent = emoji;
            return element;
          },
        },
        markdownReveal: {
          revealedClass: "release-markdown-revealed",
          sourceClass: "release-markdown-source",
        },
        footnoteReference: {
          HTMLAttributes: { class: "release-footnote-reference" },
          renderLabel: (label) => label,
          ariaLabel: (label) => `脚注 ${label} を表示`,
        },
        footnoteDefinition: {
          HTMLAttributes: { class: "release-footnote-definition" },
          ariaLabel: (label) => `脚注 ${label} の本文`,
        },
        codeHighlighting: {
          decorationClass: "release-code-token",
          tokenColor: ({ content, darkColor }) => {
            const token = content.trim();
            if (/^(const|function|return|await)$/u.test(token)) {
              return "var(--release-code-keyword)";
            }
            if (/^["'`]/u.test(token)) {
              return "var(--release-code-string)";
            }
            return darkColor;
          },
        },
      },
      markdown: [
        "# バージョン 2.8.0",
        "",
        "9 月 24 日に公開しました。**検索結果の改善**に加え、設定画面の *表示速度* を見直しています :white_check_mark:。詳細は [更新履歴](https://example.com/releases/2.8.0) をご覧ください。[^release]",
        "",
        "## 変更内容",
        "",
        "| 項目 | 内容 | 状況 |",
        "| --- | --- | --- |",
        "| 検索 | 結果に更新日を表示 | 完了 |",
        "| 設定 | 保存後の案内を追加 | 完了 |",
        "| 通知 | メール通知の設定 | 対応中 |",
        "|  |  |  |",
        "",
        "```typescript",
        "const DEFAULT_PAGE_SIZE = 20;",
        "function getPageCount(totalItems: number) {",
        "  return Math.ceil(totalItems / DEFAULT_PAGE_SIZE);",
        "}",
        "```",
        "",
        "検索結果が $n=128$ 件の場合、ページ数は次の式で求められます。",
        "",
        "$$",
        String.raw`p = \left\lceil \frac{n}{20} \right\rceil`,
        "$$",
        "",
        "[^release]: メール通知の設定は、順次利用できるようになります。",
      ].join("\n"),
    }),
};

export const SyntaxOptions: Story = {
  name: "構文オプションの切り替え",
  render: () =>
    createEditorStory({
      title: "本文の表示設定",
      description:
        "設定を切り替えると、該当する書式の表示が変わります。本文の編集内容は維持されます。",
      markdown: extendedMarkdown,
      syntaxOptions: true,
      showSyntaxOptions: true,
    }),
};
