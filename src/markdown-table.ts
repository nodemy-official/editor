import { getExtensionField } from "@tiptap/core";
import type {
  JSONContent,
  MarkdownLexerConfiguration,
  MarkdownParseHelpers,
  MarkdownParseResult,
  MarkdownToken,
  MarkdownTokenizer,
} from "@tiptap/core";
import { preprocessTablePipes, Table } from "@tiptap/extension-table";

import { renderMarkdownTable } from "./markdown-table-render";

type BlockTokens = MarkdownLexerConfiguration["blockTokens"];

function restoreNbspTextTokens(tokens: MarkdownToken[] | undefined) {
  return tokens?.map((token) => {
    const restored = { ...token };
    // Table cell parsing keeps entities as text tokens. Restore the entity
    // emitted by renderMarkdownTable while leaving code-span contents literal.
    if (restored.type === "text" && typeof restored.text === "string") {
      restored.text = restored.text.replaceAll("&#160;", "\u00a0");
    }
    if (restored.tokens) {
      restored.tokens = restoreNbspTextTokens(restored.tokens);
    }
    return restored;
  });
}

function restoreTableNbsp(token: MarkdownToken): MarkdownToken {
  const restoreCell = (cell: MarkdownToken) => ({
    ...cell,
    ...(cell.tokens ? { tokens: restoreNbspTextTokens(cell.tokens) } : {}),
  });
  return {
    ...token,
    ...(Array.isArray(token.header)
      ? { header: token.header.map(restoreCell) }
      : {}),
    ...(Array.isArray(token.rows)
      ? { rows: token.rows.map((row: MarkdownToken[]) => row.map(restoreCell)) }
      : {}),
  };
}

// marked invokes extension `start`/`tokenizer` callbacks with `this` bound to
// `{ lexer }`.
type TokenizerRule = (
  this: unknown,
  source: string
) => { type?: string; raw?: string } | undefined;

interface MarkedLexerContext {
  lexer?: {
    blockTokens: BlockTokens;
    inlineQueue?: { src: string; tokens: unknown[] }[];
    options?: {
      extensions?: {
        block?: ((source: string, tokens: unknown[]) => unknown)[];
      };
      pedantic?: boolean;
    };
    state?: { top?: boolean };
    tokenizer?: Record<string, TokenizerRule | undefined> & {
      table?: TokenizerRule;
    };
  };
}

type MarkedLexer = NonNullable<MarkedLexerContext["lexer"]>;

// `tokenize` and the fallback probe both lex candidates through
// `lexer.blockTokens`, whose nested pass invokes `start` again. Inside such a
// nested pass the first emitted token cannot change, so declining is exact —
// and it keeps separator-heavy documents from recursing into exponential
// rescanning.
let probing = false;

// The live lexer, captured by `start` (marked binds `this.lexer` there but not
// in `tokenize`). Only read while `probing`, i.e. inside an active parse.
let activeLexer: MarkedLexer | undefined;

// marked's blockTokens tries extension tokenizers first, then these built-in
// rules in order. A probe candidate only becomes a table when every earlier
// rule declines and the table rule accepts.
const RULES_BEFORE_TABLE = [
  "space",
  "code",
  "fences",
  "heading",
  "hr",
  "blockquote",
  "list",
  "html",
  "def",
] as const;

// `start` only needs an approximate verdict — `tokenize` re-verifies the full
// candidate — so probe input is capped to keep scanning separator-heavy
// documents near-linear.
const MAX_PROBE_LINES = 64;

// Decides whether marked's first block token for a pipe-escaped candidate
// would be a table, replicating the block rule order. Returns `undefined`
// when it cannot decide (missing internals, pedantic mode), in which case the
// real tokenizer must run. A definite `false` is exact: whatever the first
// token is, it is not a table.
function preprocessedStartsWithTable(
  preprocessed: string,
  lexer: MarkedLexer
): boolean | undefined {
  const { options, tokenizer } = lexer;
  const table = tokenizer?.table;
  if (options?.pedantic) {
    return undefined;
  }
  if (typeof table !== "function") {
    return nestedLexStartsWithTable(preprocessed, lexer);
  }
  const wasProbing = probing;
  probing = true;
  try {
    for (const extension of options?.extensions?.block ?? []) {
      const token = extension.call({ lexer }, preprocessed, []);
      if (token) {
        // Another extension producing a table is not expected; treat it as
        // undecidable rather than dropping a real table.
        return (token as { type?: string }).type === "table"
          ? undefined
          : false;
      }
    }
    for (const name of RULES_BEFORE_TABLE) {
      const rule = tokenizer?.[name];
      if (typeof rule === "function" && rule.call(tokenizer, preprocessed)) {
        return false;
      }
    }
    return Boolean(table.call(tokenizer, preprocessed)?.raw);
  } finally {
    probing = wasProbing;
  }
}

// Applies the upstream `table` tokenizer's own guards, then decides whether
// marked's first block token for `src` would be a table.
function startsWithTable(src: string, lexer: MarkedLexer): boolean | undefined {
  const blankLineIndex = src.indexOf("\n\n");
  const candidate = blankLineIndex === -1 ? src : src.slice(0, blankLineIndex);
  const candidateLines = candidate.split("\n");
  if (candidateLines.length < 2) {
    return false;
  }
  const separator = candidateLines[1];
  if (!/^[ \t|:]*-[ \t|:-]*$/u.test(separator) || !separator.includes("|")) {
    return false;
  }
  const preprocessed = preprocessTablePipes(candidate);
  if (preprocessed === candidate) {
    return false;
  }
  return preprocessedStartsWithTable(preprocessed, lexer);
}

// `lexer.tokenizer.table` is an internal marked API; when it is missing the
// probe falls back to a nested lex of the candidate, which is what the
// upstream tokenizer itself does.
function nestedLexStartsWithTable(preprocessed: string, lexer: MarkedLexer) {
  const { inlineQueue, state } = lexer;
  const queueDepth = inlineQueue?.length ?? 0;
  const previousTop = state?.top;
  const wasProbing = probing;
  probing = true;
  try {
    const token = lexer.blockTokens(preprocessed)[0];
    if (
      token?.type !== "table" &&
      inlineQueue &&
      inlineQueue.length > queueDepth
    ) {
      // Declined probes leave queued inline work for discarded tokens.
      inlineQueue.length = queueDepth;
    }
    return token?.type === "table" && Boolean(token.raw);
  } finally {
    probing = wasProbing;
    if (state) {
      state.top = previousTop;
    }
  }
}

const baseTokenizer = getExtensionField<MarkdownTokenizer | undefined>(
  Table,
  "markdownTokenizer"
);
const baseParseMarkdown = getExtensionField<
  | ((token: MarkdownToken, helpers: MarkdownParseHelpers) => MarkdownParseResult)
  | undefined
>(Table, "parseMarkdown");

const markdownTokenizer: MarkdownTokenizer | undefined = baseTokenizer && {
  ...baseTokenizer,
  tokenize(src, tokens, helper) {
    // Inside a nested probe the text is already pipe-escaped and
    // `preprocessTablePipes` is idempotent, so the upstream tokenizer always
    // declines there; shortcutting avoids re-escaping every nested slice.
    if (probing) {
      return;
    }
    const lexer = activeLexer;
    const queue = lexer?.inlineQueue;
    const queueDepth = queue?.length ?? 0;
    if (lexer) {
      let verdict: boolean | undefined;
      try {
        verdict = startsWithTable(src, lexer);
      } catch {
        verdict = undefined;
      }
      if (verdict === false) {
        // The upstream tokenizer would decline; skip its nested block lex.
        if (queue && queue.length > queueDepth) {
          queue.length = queueDepth;
        }
        return;
      }
      if (verdict === true && queue && queue.length > queueDepth) {
        // The probe's table token is discarded, so its queued cell work is
        // too; the upstream nested lex re-queues what the live token needs.
        queue.length = queueDepth;
      }
    }
    const guarded = queue
      ? {
          ...helper,
          blockTokens: (source: string) => {
            const wasProbing = probing;
            probing = true;
            try {
              const block = helper.blockTokens(source);
              // Paragraph and cell inline work is queued, not run, during
              // blockTokens. When the probe declines, nothing references the
              // nested tokens, so dropping their queue entries keeps marked
              // from lexing discarded content once per probe. Accepted tables
              // must keep their entries: marked fills cell.tokens from them.
              if (block[0]?.type !== "table" && queue.length > queueDepth) {
                queue.length = queueDepth;
              }
              return block;
            } finally {
              probing = wasProbing;
            }
          },
        }
      : helper;
    return baseTokenizer.tokenize.call(this, src, tokens, guarded);
  },
  // Replicates the upstream `table` tokenizer's acceptance checks. The stock
  // `start` fires whenever a pipe-bearing line precedes a delimiter row, even
  // when `tokenize` would decline; marked then truncates the paragraph to a
  // single character and repeats, mangling text before non-table lines such as
  // `> quote|\n> |---|` into one line per character.
  start(this: MarkedLexerContext, src: string) {
    const { lexer } = this;
    if (!lexer || probing) {
      return -1;
    }
    activeLexer = lexer;
    const lines = src.split("\n");
    const preprocessedLines = preprocessTablePipes(src).split("\n");
    const offsets: number[] = [0];
    // Pipe escaping is per line, so a probe candidate differs from its source
    // exactly where one of its lines differs. Prefix sums answer that check
    // per candidate instead of re-escaping every slice.
    const changed: number[] = [0];
    const nextBlank: number[] = [];
    let changes = 0;
    for (let index = 0; index < lines.length; index += 1) {
      if (lines[index] !== preprocessedLines[index]) {
        changes += 1;
      }
      changed.push(changes);
      if (index + 1 < lines.length) {
        offsets.push(offsets[index] + lines[index].length + 1);
      }
    }
    let boundary = lines.length;
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      nextBlank[index] = boundary;
      if (lines[index] === "") {
        boundary = index;
      }
    }
    for (let index = 1; index < lines.length - 1; index += 1) {
      // `src` starts one character into the remaining text, so the first
      // partial line can never be a table boundary.
      // A table needs a header plus the delimiter row that follows it.
      const separator = lines[index + 1];
      if (
        !/^[ \t|:]*-[ \t|:-]*$/u.test(separator) ||
        !separator.includes("|")
      ) {
        continue;
      }
      const end = nextBlank[index];
      if (end - index < 2 || changed[end] === changed[index]) {
        continue;
      }
      // `undefined` means undecidable; report the position and let `tokenize`
      // make the real decision.
      const preprocessed = preprocessedLines
        .slice(index, Math.min(end, index + MAX_PROBE_LINES))
        .join("\n");
      if (preprocessedStartsWithTable(preprocessed, lexer) === false) {
        continue;
      }
      return offsets[index];
    }
    return -1;
  },
};

export const MarkdownTable = Table.extend({
  ...(markdownTokenizer ? { markdownTokenizer } : {}),
  parseMarkdown(token, helpers) {
    return baseParseMarkdown?.call(
      this,
      restoreTableNbsp(token),
      helpers
    ) as JSONContent;
  },
  renderMarkdown: (node, helpers) => renderMarkdownTable(node, helpers),
});
