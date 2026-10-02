import { isIdentifierChar, isIdentifierStart } from "acorn";
import type { ParserConstructor } from "./acorn-internals";
import {
  expected_token,
  expected_whitespace,
  unexpected_eof,
  unexpected_reserved_word,
} from "./errors";
import type { EntityNames } from "./html-entities";
import { locate } from "./locator";
import { isTypeScript, isWhitespace, skipWhitespace } from "./markup";
import type { ParseOptions } from "./options";
import { missingTypeScript, type Support } from "./support";
import type { Identifier, SourceLocation } from "./types/estree";
import type { AST } from "./types/svelte-ast";

export const RESERVED_WORDS = new Set(
  "arguments await break case catch class const continue debugger default delete do else enum eval export extends false finally for function if implements import in instanceof interface let new null package private protected public return static super switch this throw true try typeof var void while with yield".split(
    " ",
  ),
);

const REGEX_NON_LF_LINE_BREAK = /\r(?!\n)|[\u2028\u2029]/;

export function scanIdentifier(source: string, from: number): number {
  const code = source.codePointAt(from);
  if (code === undefined || !isIdentifierStart(code, true)) return from;
  let end = from + (code <= 0xffff ? 1 : 2);
  let next = source.codePointAt(end);
  while (next !== undefined && isIdentifierChar(next, true)) {
    end += next <= 0xffff ? 1 : 2;
    next = source.codePointAt(end);
  }
  return end;
}

export type StackNode = AST.Root | AST.ElementLike | AST.Block;

export class TemplateParserState {
  source: string;
  index = 0;
  readonly loc: boolean;
  readonly lfOnly: boolean;
  readonly isTypeScript: boolean;
  readonly typescript: ParserConstructor | undefined;
  readonly entityNames: () => EntityNames;
  readonly css: boolean;
  readonly script: boolean;
  readonly comments: boolean;
  readonly root: AST.Root;
  readonly stack: StackNode[];
  readonly fragments: AST.Fragment[];
  readonly metaTags = new Set<string>();
  lastAutoClosedTag?: { tag: string; reason: string; depth: number };
  nextAngle = -1;
  nextBrace = -1;

  constructor(
    source: string,
    originalLength: number,
    support: Support,
    options: ParseOptions = {},
  ) {
    this.source = source;
    this.loc = options.loc ?? false;
    this.lfOnly = this.loc && !REGEX_NON_LF_LINE_BREAK.test(source);
    this.isTypeScript = isTypeScript(source);
    this.typescript = support.typescript;
    if (this.isTypeScript && !this.typescript) missingTypeScript();
    this.entityNames = support.entityNames;
    this.css = options.css ?? true;
    this.script = options.script ?? true;
    this.comments = options.comments ?? true;
    this.root = {
      type: "Root",
      start: 0,
      end: originalLength,
      css: null,
      js: [],
      options: null,
      fragment: { type: "Fragment", nodes: [] },
      comments: [],
    };
    this.stack = [this.root];
    this.fragments = [this.root.fragment];
  }

  match(str: string): boolean {
    if (str.length === 1)
      return this.source.charCodeAt(this.index) === str.charCodeAt(0);
    return this.source.startsWith(str, this.index);
  }

  matchRegex(pattern: RegExp): string | null {
    pattern.lastIndex = this.index;
    return pattern.exec(this.source)?.[0] ?? null;
  }

  eat(str: string, required = false): boolean {
    if (this.match(str)) {
      this.index += str.length;
      return true;
    }
    if (required) expected_token(this.index, str);
    return false;
  }

  read(pattern: RegExp): string | null {
    const result = this.matchRegex(pattern);
    if (result) this.index += result.length;
    return result;
  }

  readUntil(needle: string): string {
    if (this.index >= this.source.length) unexpected_eof(this.source.length);
    const found = this.source.indexOf(needle, this.index);
    const end = found === -1 ? this.source.length : found;
    const result = this.source.slice(this.index, end);
    this.index = end;
    return result;
  }

  allowWhitespace(): void {
    this.index = skipWhitespace(this.source, this.index);
  }

  requireWhitespace(): void {
    if (!isWhitespace(this.source.charCodeAt(this.index))) {
      expected_whitespace(this.index);
    }
    this.allowWhitespace();
  }

  eatClosingBrace(): void {
    this.allowWhitespace();
    this.eat("}", true);
  }

  sourceLocation(start: number, end: number): SourceLocation | undefined {
    return this.loc ? { start: locate(start), end: locate(end) } : undefined;
  }

  readIdentifierName(): Identifier {
    const start = this.index;
    const end = scanIdentifier(this.source, start);
    const name = this.source.slice(start, end);
    this.index = end;
    if (RESERVED_WORDS.has(name)) unexpected_reserved_word(start, name);
    const identifier: Identifier = { type: "Identifier", name, start, end };
    if (this.loc) identifier.loc = this.sourceLocation(start, end);
    return identifier;
  }

  current(): StackNode {
    return this.stack[this.stack.length - 1];
  }

  append(node: AST.Fragment["nodes"][number]): void {
    this.fragments[this.fragments.length - 1].nodes.push(node);
  }

  open(
    node: StackNode & AST.Fragment["nodes"][number],
    fragment: AST.Fragment,
  ): void {
    this.append(node);
    this.stack.push(node);
    this.fragments.push(fragment);
  }

  setFragment(fragment: AST.Fragment): void {
    this.fragments[this.fragments.length - 1] = fragment;
  }

  close(): void {
    this.stack.pop();
    this.fragments.pop();
  }
}
