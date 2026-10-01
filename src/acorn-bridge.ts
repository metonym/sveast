import {
  type Node as AcornNode,
  definePlugin,
  extendParser,
  type ForInit,
  type ParserConstructor,
  type ParserOptions,
  type WordTester,
} from "./acorn-internals";
import {
  attachComments,
  bindOnComment,
  type Comment,
  lastCommentEnd,
  onComment,
  skipComment,
} from "./comments";
import { js_parse_error, unexpected_eof } from "./errors";
import { locate } from "./locator";
import { mapChildren } from "./nodes";
import { tsPlugin } from "./ts-plugin";
import type { Expression, Node, Program, Statement } from "./types/estree";

let sawParenthesized = false;

const WORD_TESTERS = new Map<RegExp, WordTester>();

function wordTester(words: WordTester): WordTester {
  if (!(words instanceof RegExp)) return words;
  let tester = WORD_TESTERS.get(words);
  if (!tester) {
    const set = new Set(words.source.slice(4, -2).split("|"));
    tester = { test: (word) => set.has(word) };
    WORD_TESTERS.set(words, tester);
  }
  return tester;
}

// svelte's own acorn.js subclasses the same way
const tweaks = definePlugin((Base) => {
  const { keywordTypes, tokTypes } = Base.acorn;
  const keywordTokens = new Map(
    "break case catch continue debugger default do else finally for function if return switch throw try var while with null true false instanceof typeof void delete new in this const class extends export import super"
      .split(" ")
      .map((word) => [word, keywordTypes[word]] as const),
  );

  return class extends Base {
    constructor(options: ParserOptions, input: string, startPos?: number) {
      super(options, input, startPos);
      this.keywords = wordTester(this.keywords);
      this.reservedWords = wordTester(this.reservedWords);
      this.reservedWordsStrict = wordTester(this.reservedWordsStrict);
      this.reservedWordsStrictBind = wordTester(this.reservedWordsStrictBind);
    }

    parseParenAndDistinguishExpression(canBeArrow: boolean, forInit: ForInit) {
      const node = super.parseParenAndDistinguishExpression(
        canBeArrow,
        forInit,
      );
      if (node.type === "ParenthesizedExpression") sawParenthesized = true;
      return node;
    }

    checkLocalExport() {
      // skips acorn's check that exported names are declared, as svelte's acorn.js does
    }

    skipSpace() {
      const input = this.input;
      const locations = this.options.locations;
      let pos = this.pos;
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
      const input = this.input;
      const start = this.pos;
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
      return this.finishToken(keywordTokens.get(word) ?? tokTypes.name, word);
    }
  };
});

const JSParser = extendParser(tweaks);
const TSParser = extendParser(tsPlugin, tweaks);

interface ParseContext {
  isTypeScript: boolean;
  loc: boolean;
  comments: boolean;
  lfOnly?: boolean;
  root: { comments: Comment[] };
}

const REGEX_POSITION_SUFFIX = / \(\d+:\d+\)$/;

/** acorn's nodes are estree nodes; the plugin's parse methods are typed with its own looser `Node`. */
function estree<T extends Node>(node: AcornNode): T {
  return node as unknown as T;
}

/** acorn's `SyntaxError` for a syntax error, which carries the offset it points at. */
function isSyntaxErrorAt(
  error: unknown,
): error is SyntaxError & { pos: number } {
  return (
    error instanceof SyntaxError &&
    "pos" in error &&
    typeof error.pos === "number"
  );
}

function run(
  context: ParseContext,
  source: string,
  start: number,
  preserveParens: boolean,
  parse: (ParserClass: ParserConstructor, options: ParserOptions) => AcornNode,
  commentsBefore = context.root.comments.length,
): AcornNode {
  const comments = context.root.comments;
  bindOnComment(source, comments);
  const options: ParserOptions = {
    onComment: context.comments ? onComment : skipComment,
    sourceType: "module",
    ecmaVersion: 16,
    locations: context.loc,
    preserveParens,
  };
  if (context.lfOnly) options.startLocation = locate(start);
  let node: AcornNode;
  try {
    node = parse(context.isTypeScript ? TSParser : JSParser, options);
  } catch (error) {
    if (!isSyntaxErrorAt(error)) throw error;
    js_parse_error(error.pos, error.message.replace(REGEX_POSITION_SUFFIX, ""));
  }
  if (comments.length > commentsBefore) {
    attachComments(estree(node), comments, start);
  }
  return node;
}

export function parseProgram(
  context: ParseContext,
  source: string,
  start = 0,
): Program {
  return estree(
    run(
      context,
      source,
      0,
      false,
      (ParserClass, options) => {
        if (start > 0 && options.locations) {
          options.startLocation = locate(start);
        }
        const program = new ParserClass(options, source, start).parse();
        program.start = 0;
        return program;
      },
      0,
    ),
  );
}

export const acornExpressionParses = { count: 0 };

export function parseExpressionAt(
  context: ParseContext,
  source: string,
  index: number,
  keepParens = false,
): { node: Expression; end: number } {
  acornExpressionParses.count += 1;
  sawParenthesized = false;
  const node = estree<Expression>(
    run(context, source, index, true, (ParserClass, options) =>
      ParserClass.parseExpressionAt(source, index, options),
    ),
  );

  const end = Math.max(node.end, lastCommentEnd());

  return {
    node: sawParenthesized && !keepParens ? removeParens(node) : node,
    end,
  };
}

export function parseStatementAt(
  context: ParseContext,
  source: string,
  index: number,
): Statement {
  return estree(
    run(context, source, index, false, (ParserClass, options) => {
      const parser = new ParserClass(options, source, index);
      try {
        parser.nextToken();
        return parser.parseStatement(null, true, Object.create(null));
      } catch (error) {
        if (isSyntaxErrorAt(error) && error.pos === source.length) {
          unexpected_eof(source.length);
        }
        throw error;
      }
    }),
  );
}

function removeParens<T extends Node>(node: T): T;
function removeParens(node: Node): Node {
  let inner = node;
  while (inner.type === "ParenthesizedExpression") inner = inner.expression;
  mapChildren(inner, removeParens);
  return inner;
}
