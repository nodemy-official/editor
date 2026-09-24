import { Editor } from "@tiptap/core";
import type { MarkdownEditorExtensionsOptions } from "../src/markdown-editor-extensions";
import { createMarkdownEditorExtensions } from "../src/markdown-editor-extensions";
import type { Meta, StoryObj } from "@storybook/html-vite";

import "katex/dist/katex.min.css";
import "./markdown-editor.css";

type SyntaxOptions = NonNullable<MarkdownEditorExtensionsOptions["extendedSyntax"]>;

interface DemoConfig {
  title: string;
  description: string;
  markdown: string;
  math?: MarkdownEditorExtensionsOptions["math"];
  syntaxOptions?: SyntaxOptions;
  showSyntaxOptions?: boolean;
  themeClass?: string;
  extensionOptions?: Omit<MarkdownEditorExtensionsOptions, "extendedSyntax">;
  customizationPoints?: Array<{ setting: string; detail: string }>;
}

const extendedMarkdown = [
  "# 拡張構文の例",
  "",
  "**太字**、*斜体*、~~取り消し線~~、`インラインコード`、:smile: を含む文章です。",
  "",
  "## タスクリストと表",
  "",
  "- [x] 完了した項目",
  "- [ ] これから行う項目",
  "",
  "| 項目 | 状態 |",
  "| --- | --- |",
  "| Markdown | 編集中 |",
  "| Storybook | 表示中 |",
  "",
  "脚注[^note]と URL の自動リンク https://example.com も試せます。",
  "",
  "[^note]: 脚注の本文です。",
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
    summary.textContent = "シリアライズされた Markdown";
    this.markdownOutput = document.createElement("pre");
    output.append(summary, this.markdownOutput);

    workspace.append(toolbar, editorPanel, output);
    this.append(header);
    if (storyConfig.customizationPoints) {
      this.append(this.createCustomizationMap(storyConfig.customizationPoints));
    }
    this.append(workspace);
    this.addToolbarButtons(toolbar);
    this.mountEditor(storyConfig.syntaxOptions ?? true);
  }

  private createCustomizationMap(
    points: Array<{ setting: string; detail: string }>
  ) {
    const section = document.createElement("section");
    section.className = "markdown-editor-story__customization-map";
    const heading = document.createElement("h2");
    heading.textContent = "この Story で使っているカスタマイズ API";
    const list = document.createElement("ul");
    for (const point of points) {
      const item = document.createElement("li");
      const setting = document.createElement("code");
      setting.textContent = point.setting;
      const detail = document.createElement("span");
      detail.textContent = point.detail;
      item.append(setting, detail);
      list.append(item);
    }
    section.append(heading, list);
    return section;
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
        this.currentMarkdown = this.editor?.getMarkdown() ?? this.currentMarkdown;
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
    const actions: Array<{ label: string; title: string; run: (editor: Editor) => void }> = [
      { label: "B", title: "太字", run: (editor) => editor.chain().focus().toggleBold().run() },
      { label: "I", title: "斜体", run: (editor) => editor.chain().focus().toggleItalic().run() },
      { label: "S", title: "取り消し線", run: (editor) => editor.chain().focus().toggleStrike().run() },
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
    updateOutput();
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
      title: "Markdown を編集する",
      description:
        "本文をクリックして編集できます。選択範囲に書式を付けたり、Markdown の出力を確認したりできます。",
      markdown: [
        "# はじめての編集",
        "",
        "この文章をクリックして書き換えてみてください。**太字**、*斜体*、`コード`も試せます。",
        "",
        "- ツールバーから見出しやリストを追加",
        "- 入力した Markdown は下の出力欄に反映",
      ].join("\n"),
    }),
};

export const ExtendedSyntax: Story = {
  name: "拡張構文",
  render: () =>
    createEditorStory({
      title: "GFM・脚注・絵文字",
      description:
        "GFM の表、タスクリスト、取り消し線と URL 自動リンクに加え、脚注と :smile: の表示を確認できます。",
      markdown: extendedMarkdown,
    }),
};

export const Math: Story = {
  name: "数式（オプトイン）",
  render: () =>
    createEditorStory({
      title: "Markdown の数式",
      description:
        "math: true で有効になります。数式をクリックすると Markdown ソースを直接書き換えられます。別の場所へカーソルを移すと再描画され、下で出力を確認できます。",
      math: true,
      markdown: [
        "インライン数式: $E = mc^2$、分数: $\\frac{1}{2}$。",
        "",
        "ブロック数式:",
        "",
        "$$",
        String.raw`\int_0^1 x^2 \, dx = \frac{1}{3}`,
        "$$",
      ].join("\n"),
    }),
};

export const FullyCustomizedDesign: Story = {
  name: "デザインを全面カスタマイズ",
  render: () =>
    createEditorStory({
      title: "色・余白・記号を、プロダクトのデザインに合わせる",
      description:
        "既定の青と白のテーマから、夜色のフレームと温かい紙面を使う編集画面へ変更しています。下の本文を編集し、表の空セル、絵文字、脚注、コード、数式と、構文を編集中の表示を確認してください。",
      themeClass: "markdown-editor-story--atelier",
      math: {
        HTMLAttributes: {
          class: "atelier-math",
          "data-math-skin": "orchid",
        },
      },
      extensionOptions: {
        tablePlaceholders: {
          emptyCellClassName: "atelier-empty-cell",
          placeholderClassName: "atelier-empty-hint",
          placeholderText: "ADD",
          renderPlaceholder: ({ document, className, text }) => {
            const placeholder = document.createElement("span");
            placeholder.className = className;
            placeholder.setAttribute("aria-hidden", "true");
            const marker = document.createElement("span");
            marker.className = "atelier-empty-hint__marker";
            marker.textContent = "+";
            const label = document.createElement("span");
            label.textContent = text;
            placeholder.append(marker, label);
            return placeholder;
          },
        },
        emojiDecorations: {
          sourceClassName: "atelier-emoji-source",
          emojiClassName: "atelier-emoji",
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
          revealedClass: "atelier-markdown-revealed",
          sourceClass: "atelier-markdown-source",
        },
        footnoteReference: {
          HTMLAttributes: { class: "atelier-footnote-reference" },
          renderLabel: (label) => `ref ${label}`,
          ariaLabel: (label) => `脚注 ${label} へ移動`,
        },
        footnoteDefinition: {
          HTMLAttributes: { class: "atelier-footnote-definition" },
          ariaLabel: (label) => `脚注 ${label} の本文`,
        },
        codeHighlighting: {
          decorationClass: "atelier-code-token",
          tokenColor: ({ content, darkColor }) => {
            const token = content.trim();
            if (/^(const|function|return|await)$/u.test(token)) {
              return "var(--atelier-code-keyword)";
            }
            if (/^["'`]/u.test(token)) {
              return "var(--atelier-code-string)";
            }
            return darkColor;
          },
        },
      },
      customizationPoints: [
        {
          setting: "themeClass + CSS variables",
          detail: "Story 専用の配色、書体、余白、ボタン、表、出力欄を定義",
        },
        {
          setting: "tablePlaceholders.renderPlaceholder",
          detail: "空セルに独自の追加マークとラベルを描画",
        },
        {
          setting: "emojiDecorations.renderEmoji",
          detail: "絵文字 DOM とアクセシブルなラベルを置き換え",
        },
        {
          setting: "markdownReveal.revealedClass / sourceClass",
          detail: "Markdown 構文の表示状態を専用クラスで装飾",
        },
        {
          setting: "footnoteReference.renderLabel / HTMLAttributes",
          detail: "脚注マーカーの文言・クラスと本文の見た目を変更",
        },
        {
          setting: "codeHighlighting.decorationClass / tokenColor",
          detail: "コードトークンへ独自クラスを付け、色を CSS 変数へ接続",
        },
        {
          setting: "math.HTMLAttributes",
          detail: "インライン・ブロック数式にテーマ用クラスを設定",
        },
      ],
      markdown: [
        "# 色と記号を編集する",
        "",
        "紙面の **強調**、*斜体*、`inline code`、:sparkles:、脚注[^palette] と数式 $a^2 + b^2 = c^2$ を試せます。",
        "",
        "> 引用やリンクも、この編集領域のスタイルに合わせて変わります。",
        "",
        "| トークン | 用途 | 状態 |",
        "| --- | --- | --- |",
        "| --paper | 背景 | ready |",
        "| --accent | 強調 | review |",
        "|  |  |  |",
        "",
        "```typescript",
        'const palette = { accent: "#ff4f81", paper: "#fff5df" };',
        "function applyTheme(name: string) {",
        "  return `${name} · ${palette.accent}`;",
        "}",
        "```",
        "",
        "ブロック数式:",
        "",
        "$$",
        String.raw`\sum_{i=1}^{n} i = \frac{n(n+1)}{2}`,
        "$$",
        "",
        "[^palette]: 太字やリンクの上にカーソルを置き、Markdown 構文が現れる表示も確認できます。",
      ].join("\n"),
    }),
};

export const SyntaxOptions: Story = {
  name: "構文オプションの切り替え",
  render: () =>
    createEditorStory({
      title: "拡張構文を切り替える",
      description:
        "チェックを切り替えると現在の文章を保ったまま Editor を作り直し、構文設定を反映します。",
      markdown: extendedMarkdown,
      syntaxOptions: true,
      showSyntaxOptions: true,
    }),
};
