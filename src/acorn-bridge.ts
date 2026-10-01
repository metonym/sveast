import type { Options } from "acorn";
// @ts-expect-error acorn's published types don't declare `keywordTypes`. state.ts imports the same way.
import { keywordTypes, Parser, tokTypes } from "acorn";
import {
  attachComments,
  bindOnComment,
  type Comment,
  onComment,
} from "./comments";
import { js_parse_error, unexpected_eof } from "./errors";
import { locate } from "./locator";
import { tsPlugin } from "./ts-plugin";
import type { Program } from "./types/estree";

type ScriptProgram = Program & { start: number; end: number };

let sawParenthesized = false;

const KEYWORD_TOKENS = new Map(
  "break case catch continue debugger default do else finally for function if return switch throw try var while with null true false instanceof typeof void delete new in this const class extends export import super"
    .split(" ")
    .map((word) => [word, keywordTypes[word]] as const),
);

const WORD_TESTERS = new Map<RegExp, { test(word: string): boolean }>();

function wordTester(regex: RegExp) {
  let tester = WORD_TESTERS.get(regex);
  if (!tester) {
    const words = new Set(regex.source.slice(4, -2).split("|"));
    tester = { test: (word) => words.has(word) };
    WORD_TESTERS.set(regex, tester);
  }
  return tester;
}

// biome-ignore lint/suspicious/noExplicitAny: these methods aren't in acorn's published Parser type; svelte's own acorn.js subclasses the same way
const tweaks = ((BaseParser: any) =>
  class extends BaseParser {
    // biome-ignore lint/suspicious/noExplicitAny: acorn's constructor arguments
    constructor(...args: any[]) {
      super(...args);
      this.keywords = wordTester(this.keywords);
      this.reservedWords = wordTester(this.reservedWords);
      this.reservedWordsStrict = wordTester(this.reservedWordsStrict);
      this.reservedWordsStrictBind = wordTester(this.reservedWordsStrictBind);
    }

    parseParenAndDistinguishExpression(canBeArrow: boolean, forInit: boolean) {
      const node = super.parseParenAndDistinguishExpression(
        canBeArrow,
        forInit,
      );
      if (node.type === "ParenthesizedExpression") sawParenthesized = true;
      return node;
    }

    checkLocalExport() {}

    skipSpace() {
      const input: string = this.input;
      const locations: boolean = this.options.locations;
      let pos: number = this.pos;
      let code = input.charCodeAt(pos);
      for (;;) {
        if (code === 32 || code === 9) {
          code = input.charCodeAt(++pos);
        } else if (code === 10) {
          code = input.charCodeAt(++pos);
          if (locations) {
            this.curLine++;
            this.lineStart = pos;
          }
        } else break;
      }
      this.pos = pos;
      if (code === 47 || code < 33 || code >= 128) super.skipSpace();
    }

    readWord1() {
      const input: string = this.input;
      const start: number = this.pos;
      let end = start;
      let code = input.charCodeAt(end);
      while (
        (code >= 97 && code <= 122) ||
        (code >= 65 && code <= 90) ||
        (code >= 48 && code <= 57) ||
        code === 95 ||
        code === 36
      ) {
        code = input.charCodeAt(++end);
      }
      if (code >= 128 || code === 92) return super.readWord1();
      this.containsEsc = false;
      this.pos = end;
      return input.slice(start, end);
    }

    readWord() {
      const word = this.readWord1();
      return this.finishToken(KEYWORD_TOKENS.get(word) ?? tokTypes.name, word);
    }
  }) as unknown as (BaseParser: typeof Parser) => typeof Parser;

const JSParser = Parser.extend(tweaks);
const TSParser = Parser.extend(tsPlugin, tweaks);

interface ParseContext {
  isTypeScript: boolean;
  loc: boolean;
  lfOnly?: boolean;
  root: { comments: Comment[] };
}

const REGEX_POSITION_SUFFIX = / \(\d+:\d+\)$/;

function run(
  context: ParseContext,
  source: string,
  start: number,
  preserveParens: boolean,
  // biome-ignore lint/suspicious/noExplicitAny: the statement parse calls methods acorn's published types don't declare
  parse: (ParserClass: any, options: Options) => AnyNode,
  commentsBefore = context.root.comments.length,
): AnyNode {
  const comments = context.root.comments;
  bindOnComment(source, comments);
  const options = {
    onComment,
    sourceType: "module",
    ecmaVersion: 16,
    locations: context.loc,
    preserveParens,
  } as Options & { startLocation?: unknown };
  if (context.lfOnly) options.startLocation = locate(start);
  let node: AnyNode;
  try {
    node = parse(context.isTypeScript ? TSParser : JSParser, options);
  } catch (error) {
    const pos = (error as { pos?: number }).pos;
    if (pos === undefined) throw error;
    js_parse_error(
      pos,
      (error as Error).message.replace(REGEX_POSITION_SUFFIX, ""),
    );
  }
  if (comments.length > commentsBefore) attachComments(node, comments, start);
  return node;
}

export function parseProgram(
  context: ParseContext,
  source: string,
  start = 0,
): ScriptProgram {
  return run(
    context,
    source,
    0,
    false,
    (ParserClass, options) => {
      if (start > 0 && options.locations) {
        (options as { startLocation?: unknown }).startLocation = locate(start);
      }
      const program = new ParserClass(options, source, start).parse();
      program.start = 0;
      return program;
    },
    0,
  ) as unknown as ScriptProgram;
}

export const acornExpressionParses = { count: 0 };

export function parseExpressionAt(
  context: ParseContext,
  source: string,
  index: number,
  keepParens = false,
): { node: AnyNode; end: number } {
  acornExpressionParses.count += 1;
  sawParenthesized = false;
  const node = run(context, source, index, true, (ParserClass, options) =>
    ParserClass.parseExpressionAt(source, index, options),
  );

  const lastComment = context.root.comments.at(-1);
  const end =
    lastComment && lastComment.end > node.end ? lastComment.end : node.end;

  return {
    node: sawParenthesized && !keepParens ? removeParens(node) : node,
    end,
  };
}

export function parseStatementAt(
  context: ParseContext,
  source: string,
  index: number,
): AnyNode {
  return run(context, source, index, false, (ParserClass, options) => {
    const parser = new ParserClass(options, source, index);
    try {
      parser.nextToken();
      return parser.parseStatement(null, true, Object.create(null));
    } catch (error) {
      if ((error as { pos?: number }).pos === source.length) {
        unexpected_eof(source.length);
      }
      throw error;
    }
  });
}

export interface AnyNode {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

function isNode(value: unknown): value is AnyNode {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as AnyNode).type === "string"
  );
}

export function mapChildren(
  node: AnyNode,
  map: (child: AnyNode) => AnyNode,
): void {
  for (const key in node) {
    const value = node[key];
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        if (isNode(value[i])) value[i] = map(value[i]);
      }
    } else if (isNode(value)) {
      node[key] = map(value);
    }
  }
}

function removeParens<T>(node: T): T {
  let inner = node as AnyNode;
  while (inner.type === "ParenthesizedExpression") {
    inner = inner.expression as AnyNode;
  }
  mapChildren(inner, removeParens);
  return inner as T;
}
