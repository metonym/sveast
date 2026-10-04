import type { Position } from "acorn";
import {
  type Node as AcornNode,
  type DestructuringErrors,
  definePlugin,
  type ExportedNames,
  extendParser,
  type ForInit,
  type ParserConstructor,
  type ParserInternals,
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
import { lineBreaksBefore, locate } from "./locator";
import { internName } from "./names";
import { mapChildren } from "./nodes";
import { RESERVED_WORDS } from "./reserved-words";
import { hasName } from "./scope-names";
import { missingTypeScript } from "./support";
import type {
  Expression,
  ModuleDeclaration,
  Node,
  Pattern,
  Program,
  Statement,
} from "./types/estree";

let sawParenthesized = false;

const SCOPE_TOP = 1;
const SCOPE_FUNCTION = 2;
const SCOPE_SIMPLE_CATCH = 32;
const SCOPE_CLASS_STATIC_BLOCK = 256;
const SCOPE_VAR = SCOPE_TOP | SCOPE_FUNCTION | SCOPE_CLASS_STATIC_BLOCK;
const BIND_LEXICAL = 2;
const BIND_FUNCTION = 3;
const BIND_SIMPLE_CATCH = 4;
const LINE_BREAK = /\r\n?|\n|\u2028|\u2029/;

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

// acorn's declareName with `hasName` for its `indexOf`s; the TypeScript plugin's declareName calls it
export const declarations = definePlugin(
  (Base) =>
    class extends Base {
      declareName(name: string, bindingType: number, pos: number) {
        let redeclared = false;
        if (bindingType === BIND_LEXICAL) {
          const scope = this.currentScope();
          redeclared =
            hasName(scope.lexical, name) ||
            hasName(scope.functions, name) ||
            hasName(scope.var, name);
          scope.lexical.push(name);
          if (this.inModule && scope.flags & SCOPE_TOP) {
            delete this.undefinedExports[name];
          }
        } else if (bindingType === BIND_SIMPLE_CATCH) {
          this.currentScope().lexical.push(name);
        } else if (bindingType === BIND_FUNCTION) {
          const scope = this.currentScope();
          redeclared = this.treatFunctionsAsVar
            ? hasName(scope.lexical, name)
            : hasName(scope.lexical, name) || hasName(scope.var, name);
          scope.functions.push(name);
        } else {
          for (let i = this.scopeStack.length - 1; i >= 0; --i) {
            const scope = this.scopeStack[i];
            if (
              (hasName(scope.lexical, name) &&
                !(
                  scope.flags & SCOPE_SIMPLE_CATCH && scope.lexical[0] === name
                )) ||
              (!this.treatFunctionsAsVarInScope(scope) &&
                hasName(scope.functions, name))
            ) {
              redeclared = true;
              break;
            }
            scope.var.push(name);
            if (this.inModule && scope.flags & SCOPE_TOP) {
              delete this.undefinedExports[name];
            }
            if (scope.flags & SCOPE_VAR) break;
          }
        }
        if (redeclared) {
          this.raiseRecoverable(
            pos,
            `Identifier '${name}' has already been declared`,
          );
        }
      }
    },
);

// svelte's own acorn.js subclasses the same way
export const tweaks = definePlugin((Base) => {
  const { keywordTypes, tokTypes } = Base.acorn;
  const keywordTokens = new Map(
    "break case catch continue debugger default do else finally for function if return switch throw try var while with null true false instanceof typeof void delete new in this const class extends export import super"
      .split(" ")
      .map((word) => [word, keywordTypes[word]] as const),
  );

  let initialContext: unknown;
  return class extends Base {
    constructor(options: ParserOptions, input: string, startPos?: number) {
      super(options, input, startPos);
      this.keywords = wordTester(this.keywords);
      this.reservedWords = wordTester(this.reservedWords);
      this.reservedWordsStrict = wordTester(this.reservedWordsStrict);
      this.reservedWordsStrictBind = wordTester(this.reservedWordsStrictBind);
      initialContext ??= this.context[0];
    }

    // acorn's constructor from `this.input` on, for a module; `tests/acorn-bridge.test.ts` checks it against a new parser
    reset(
      input: string,
      pos: number,
      startLocation: ParserOptions["startLocation"],
    ) {
      super.reset?.(input, pos, startLocation);
      this.input = input;
      this.containsEsc = false;
      this.pos = pos;
      if (startLocation) {
        this.lineStart = pos - startLocation.column;
        this.curLine = startLocation.line;
      } else {
        this.lineStart = input.lastIndexOf("\n", pos - 1) + 1;
        this.curLine = this.options.locations
          ? input.slice(0, this.lineStart).split(LINE_BREAK).length
          : 1;
      }
      this.type = tokTypes.eof;
      this.value = null as unknown as string;
      this.start = this.end = pos;
      this.startLoc = this.endLoc = this.curPosition();
      this.lastTokEndLoc = this.lastTokStartLoc = null as unknown as Position;
      this.lastTokStart = this.lastTokEnd = pos;
      const context = this.context;
      if (context.length !== 1 || context[0] !== initialContext) {
        this.context = this.initialContext();
      }
      this.exprAllowed = true;
      this.strict = true;
      this.potentialArrowAt = -1;
      this.potentialArrowInForAwait = false;
      this.yieldPos = this.awaitPos = this.awaitIdentPos = 0;
      if (this.labels.length > 0) this.labels = [];
      for (const _ in this.undefinedExports) {
        this.undefinedExports = Object.create(null);
        break;
      }
      const scopes = this.scopeStack;
      const top = scopes[0];
      if (
        scopes.length !== 1 ||
        top.flags !== SCOPE_TOP ||
        top.var.length > 0 ||
        top.lexical.length > 0 ||
        top.functions.length > 0 ||
        top.tsTypes !== undefined ||
        top.tsExportOnly !== undefined ||
        top.tsEnums !== undefined
      ) {
        this.scopeStack = [];
        this.enterScope(SCOPE_TOP);
      }
      this.regexpState = null;
      if (this.privateNameStack.length > 0) this.privateNameStack = [];
      // acorn sets this one only once it reads a template; a new parser has it unset
      this.inTemplateElement = false;
    }

    parseParenAndDistinguishExpression(canBeArrow: boolean, forInit: ForInit) {
      const node = super.parseParenAndDistinguishExpression(
        canBeArrow,
        forInit,
      );
      if (node.type === "ParenthesizedExpression") sawParenthesized = true;
      return node;
    }

    checkUnreserved(ref: AcornNode) {
      if (RESERVED_WORDS.has(ref.name)) super.checkUnreserved(ref);
    }

    canInsertSemicolon() {
      const type = this.type;
      if (type === tokTypes.eof || type === tokTypes.braceR) return true;
      const input = this.input;
      for (let i = this.lastTokEnd; i < this.start; i++) {
        const code = input.charCodeAt(i);
        if (code === 10 || code === 13 || code === 0x2028 || code === 0x2029) {
          return true;
        }
      }
      return false;
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
      let hash = 0;
      while (
        (code >= 97 && code <= 122) ||
        (code >= 65 && code <= 90) ||
        (code >= 48 && code <= 57) ||
        code === 95 ||
        code === 36
      ) {
        hash = (hash * 31 + code) | 0;
        code = input.charCodeAt(++end);
      }
      if (code >= 128 || code === 92) return super.readWord1();
      this.containsEsc = false;
      this.pos = end;
      return internName(input, start, end, hash);
    }

    readWord() {
      const word = this.readWord1();
      return this.finishToken(keywordTokens.get(word) ?? tokTypes.name, word);
    }
  };
});

const JSParser = extendParser(declarations, tweaks);

interface ParseContext {
  isTypeScript: boolean;
  typescript: ParserConstructor | undefined;
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
  const ParserClass = context.isTypeScript ? context.typescript : JSParser;
  if (!ParserClass) missingTypeScript();
  let node: AcornNode;
  try {
    node = parse(ParserClass, options);
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

/**
 * Where acorn's constructor would put a parser starting at `index` of the
 * component: the column from the last `\n`, and with `locations`, the line
 * after every line break before it. Every markup expression's source has
 * the component's text before `index`, so the locator's line starts give
 * it without scanning back from each expression.
 */
function acornLocation(
  index: number,
  locations: boolean | undefined,
): { line: number; column: number } {
  const { column } = locate(index);
  return {
    line: locations ? lineBreaksBefore(index - column) + 1 : 1,
    column,
  };
}

export const acornExpressionParses = { count: 0 };

interface SpareParser {
  ParserClass: ParserConstructor;
  onComment: ParserOptions["onComment"];
  locations: ParserOptions["locations"];
  parser: ParserInternals;
}

let spare: SpareParser | undefined;

type Read = (parser: ParserInternals) => AcornNode;

const readExpression: Read = (parser) => parser.parseExpression();

/**
 * acorn's `parseExpressionAt`, reading with `read`, but with the last
 * call's parser when the options match: a markup expression is short, so
 * constructing a parser is a large part of its cost. A parser that threw
 * is dropped.
 */
function parseWith(
  ParserClass: ParserConstructor,
  options: ParserOptions,
  source: string,
  index: number,
  read: Read,
): AcornNode {
  let entry = spare;
  spare = undefined;
  if (
    entry?.ParserClass === ParserClass &&
    entry.onComment === options.onComment &&
    entry.locations === options.locations &&
    entry.parser.reset
  ) {
    entry.parser.reset(source, index, options.startLocation);
  } else {
    entry = {
      ParserClass,
      onComment: options.onComment,
      locations: options.locations,
      parser: new ParserClass(options, source, index),
    };
  }
  const parser = entry.parser;
  parser.nextToken();
  const node = read(parser);
  parser.input = "";
  spare = entry;
  return node;
}

function parseMarkupAt(
  context: ParseContext,
  source: string,
  index: number,
  read: Read,
): AcornNode {
  acornExpressionParses.count += 1;
  sawParenthesized = false;
  return run(context, source, index, true, (ParserClass, options) => {
    options.startLocation ??= acornLocation(index, options.locations);
    return parseWith(ParserClass, options, source, index, read);
  });
}

export function parseExpressionAt(
  context: ParseContext,
  source: string,
  index: number,
  keepParens = false,
): { node: Expression; end: number } {
  const node = estree<Expression>(
    parseMarkupAt(context, source, index, readExpression),
  );

  const end = Math.max(node.end, lastCommentEnd());

  return {
    node: sawParenthesized && !keepParens ? removeParens(node) : node,
    end,
  };
}

/**
 * The left side of `${source} = 1` read from `index`, as svelte reads a
 * destructuring pattern, without building that string: what acorn's
 * `parseMaybeAssign` does with its left side when it sees `=`. Building it
 * copied the component up to the pattern, and the pattern's strings kept
 * the copy alive. `undefined` if the expression at `index` ends before
 * `source` does.
 */
export function parsePatternAt(
  context: ParseContext,
  source: string,
  index: number,
): Pattern | undefined {
  const comments = context.root.comments.length;
  let complete = true;
  const node = parseMarkupAt(context, source, index, (parser) => {
    const refDestructuringErrors: DestructuringErrors = {
      shorthandAssign: -1,
      trailingComma: -1,
      parenthesizedAssign: -1,
      parenthesizedBind: -1,
      doubleProto: -1,
    };
    const left = parser.parseMaybeConditional(
      undefined,
      refDestructuringErrors,
    );
    if (parser.type !== JSParser.acorn.tokTypes.eof) {
      complete = false;
      return left;
    }
    const pattern = parser.toAssignable(left, false, refDestructuringErrors);
    parser.checkLValPattern(pattern);
    return pattern;
  });
  if (!complete) {
    context.root.comments.length = comments;
    return undefined;
  }
  const pattern = estree<Pattern>(node);
  return sawParenthesized ? removeParens(pattern) : pattern;
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

/**
 * Parses the top-level statement at each offset `find` passes to
 * `parseAt`, with one parser, so a name exported or imported twice is an
 * error as in a whole module. `parseAt` returns the statement's end.
 */
export function parseStatementsAt(
  context: ParseContext,
  source: string,
  find: (parseAt: (index: number) => number) => void,
): Array<Statement | ModuleDeclaration> {
  const program = run(context, source, 0, false, (ParserClass, options) => {
    const parser = new ParserClass(options, source, 0);
    const node = parser.startNode();
    const body: AcornNode[] = [];
    const exports: ExportedNames = Object.create(null);
    find((index) => {
      parser.pos = index;
      parser.context = parser.initialContext();
      parser.exprAllowed = true;
      parser.nextToken();
      const statement = parser.parseStatement(null, true, exports);
      body.push(statement);
      return statement.end;
    });
    node.body = body;
    return parser.finishNode(node, "Program");
  });
  return estree<Program>(program).body as Array<Statement | ModuleDeclaration>;
}

function removeParens<T extends Node>(node: T): T;
function removeParens(node: Node): Node {
  let inner = node;
  while (inner.type === "ParenthesizedExpression") inner = inner.expression;
  mapChildren(inner, removeParens);
  return inner;
}
