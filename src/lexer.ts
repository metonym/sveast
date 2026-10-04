import {
  isDigit,
  isWordAt,
  isWordCode,
  scan,
  scanLiterals,
  skipTrivia,
} from "./scan";

export type {
  LexedAttribute,
  LexedComponent,
  LexedContent,
  LexedOptions,
  LexedScript,
  LexedStyle,
} from "./component-lexer";
export { lexComponent } from "./component-lexer";

/** A module specifier: the string after `from`, or after `import` in `import "a"`. */
export interface LexedSource {
  /** The string's value, with escapes decoded. */
  value: string;
  /** The offset of the opening quote. */
  start: number;
  /** The offset after the closing quote. */
  end: number;
}

/** A name an `import` binds. */
export interface LexedImportSpecifier {
  /** `"default"` for `a` in `import a from`, `"namespace"` for `* as a`, `"named"` for a name in braces. */
  kind: "default" | "namespace" | "named";
  /** The name in the imported module: `"default"`, `"*"` for a namespace, or the name before `as`, with a string's value for `"a-b" as c`. */
  imported: string;
  /** The name it's bound to in this module. */
  local: string;
  /** Whether it's only a type: in `import type`, or with `type` before it. */
  typeOnly: boolean;
  /** The offset of the name, of `*`, or of `type` before the name. */
  start: number;
  /** The offset after the local name. */
  end: number;
}

/** A name an `export … from` re-exports. */
export interface LexedExportSpecifier {
  /** `"all"` for `export *`, `"namespace"` for `export * as a`, `"named"` for a name in braces. */
  kind: "all" | "namespace" | "named";
  /** The name in the other module: `"*"` for `all` and `namespace`, or the name before `as`, with a string's value for `"a-b" as c`. */
  local: string;
  /** The name it's exported as, or `null` for `export *`. */
  exported: string | null;
  /** Whether it's only a type: in `export type`, or with `type` before it. */
  typeOnly: boolean;
  /** The offset of the name, of `*`, or of `type` before the name. */
  start: number;
  /** The offset after the exported name, or after `*` for `export *`. */
  end: number;
}

interface LexedStatementBase {
  /** The offset of `import` or `export`. */
  start: number;
  /** The offset after the statement's `;`, or its last token without one. */
  end: number;
  /** The module it imports from, or `null` for a statement the lexer doesn't recognize. */
  source: LexedSource | null;
  /** Whether it's `import type` or `export type`. */
  typeOnly: boolean;
}

/** An `import` statement. */
export interface LexedImport extends LexedStatementBase {
  kind: "import";
  specifiers: LexedImportSpecifier[];
}

/** An `export … from` statement. */
export interface LexedExport extends LexedStatementBase {
  kind: "export";
  specifiers: LexedExportSpecifier[];
}

export type LexedStatement = LexedImport | LexedExport;

/** A string literal, or the text of a template literal between two of its delimiters. */
export interface LexedString {
  /** `"string"` for a string literal, where `parseModule` has a `Literal`; `"template"` for a template's text, where it has a `TemplateElement`. */
  kind: "string" | "template";
  /** The value with escapes decoded, as a `Literal`'s `value` or a `TemplateElement`'s `value.cooked`: a template's line breaks read as `\n`. `null` for an escape that acorn rejects in a module, or that leaves a tagged template's `cooked` `null`. */
  value: string | null;
  /** The offset of the opening quote, or of a template's text, after its backtick or `}`. */
  start: number;
  /** The offset after the closing quote, or of the backtick or `${` after a template's text. */
  end: number;
}

/**
 * A module's top-level `import` statements and `export … from`
 * re-exports, read without a parser: each statement's offsets, its
 * source and the names it imports or re-exports. It finds statements as
 * {@link parseImportsExports} does with `localExports: false`, and on
 * every statement that accepts, gives the same offsets, sources and names,
 * but it doesn't check syntax and never throws. A statement it can't read,
 * including TypeScript's `import a = require("a")`, is returned with
 * `source: null` and no specifiers, ending where it stopped reading.
 * TypeScript's `type` forms are always read.
 */
export function lexImportsExports(source: string): LexedStatement[] {
  const lexer = new Lexer(source);
  const statements: LexedStatement[] = [];
  scan(source, false, (_start, keyword) => {
    const statement = lexer.statement(keyword);
    statements.push(statement);
    return statement.end;
  });
  return statements;
}

/**
 * A module's string literals and the text of its template literals, in
 * source order, read without a parser: the offsets and value of each
 * `Literal` with a string value and each `TemplateElement` that
 * {@link parseModule} returns, for a tool that only needs a script's
 * strings, such as one that looks for class names. Comments and regular
 * expressions are skipped, as `parseModule` skips them. It tells a regular
 * expression from a division by the token before it, as acorn's tokenizer
 * does, and doesn't check syntax, so it never throws. A template's raw
 * text is `source.slice(start, end)`, with `\r\n` and `\r` as `\n`.
 */
export function lexStrings(source: string): LexedString[] {
  const lexer = new Lexer(source);
  const strings: LexedString[] = [];
  scanLiterals(source, (start, end, template) => {
    strings.push(
      template
        ? {
            kind: "template",
            value: lexer.cooked(start, end, true),
            start,
            end,
          }
        : {
            kind: "string",
            value: lexer.cooked(start + 1, end - 1, false),
            start,
            end,
          },
    );
  });
  return strings;
}

class Lexer {
  readonly source: string;
  /** The cursor. */
  pos = 0;
  /** The offset after the last token read. */
  end = 0;
  escapeEnd = 0;

  constructor(source: string) {
    this.source = source;
  }

  statement(keyword: number): LexedStatement {
    this.pos = this.end = keyword + 6;
    const statement: LexedStatement =
      this.source.charCodeAt(keyword) === 105
        ? {
            kind: "import",
            start: keyword,
            end: 0,
            source: null,
            typeOnly: false,
            specifiers: [],
          }
        : {
            kind: "export",
            start: keyword,
            end: 0,
            source: null,
            typeOnly: false,
            specifiers: [],
          };
    const read =
      statement.kind === "import"
        ? this.import(statement)
        : this.export(statement);
    if (!read) {
      statement.source = null;
      statement.specifiers = [];
    }
    statement.end = this.end;
    return statement;
  }

  import(statement: LexedImport): boolean {
    const module = this.string();
    if (module !== null) {
      statement.source = module;
      return this.finish();
    }
    if (this.isWord("type")) {
      const next = this.peek(4);
      if (
        next === 123 ||
        next === 42 ||
        (isIdentifierStart(next) && !this.isWordAfter(4, "from"))
      ) {
        statement.typeOnly = true;
        this.advance(4);
      }
    }
    const { specifiers, typeOnly } = statement;
    let next = this.at();
    if (next !== 123 && next !== 42) {
      const start = this.pos;
      const local = this.name();
      if (local === null) return false;
      if (this.at() === 61) return this.importEquals();
      specifiers.push({
        kind: "default",
        imported: "default",
        local,
        typeOnly,
        start,
        end: this.end,
      });
      if (!this.eat(44)) return this.from(statement);
      next = this.at();
    }
    if (next === 42) {
      const start = this.pos;
      this.advance(1);
      if (!this.eatWord("as")) return false;
      const local = this.name();
      if (local === null) return false;
      specifiers.push({
        kind: "namespace",
        imported: "*",
        local,
        typeOnly,
        start,
        end: this.end,
      });
      return this.from(statement);
    }
    if (!this.eat(123)) return false;
    while (!this.eat(125)) {
      const start = this.skip();
      const named = this.typeModifier() || typeOnly;
      const name = this.name();
      const imported = name ?? this.string()?.value;
      if (imported === undefined) return false;
      let local = name;
      if (this.eatWord("as")) local = this.name();
      if (local === null) return false;
      specifiers.push({
        kind: "named",
        imported,
        local,
        typeOnly: named,
        start,
        end: this.end,
      });
      if (!this.eat(44) && this.at() !== 125) return false;
    }
    return this.from(statement);
  }

  export(statement: LexedExport): boolean {
    if (this.eatWord("import")) {
      if (
        this.isWord("type") &&
        isIdentifierStart(this.peek(4)) &&
        !this.isWordAfter(4, "from")
      ) {
        statement.typeOnly = true;
        this.advance(4);
      }
      return this.name() !== null && this.at() === 61 && this.importEquals();
    }
    if (this.isWord("type")) {
      const next = this.peek(4);
      if (next === 123 || next === 42) {
        statement.typeOnly = true;
        this.advance(4);
      }
    }
    const { specifiers, typeOnly } = statement;
    if (this.at() === 42) {
      const start = this.pos;
      this.advance(1);
      let exported: string | null = null;
      if (this.eatWord("as")) {
        exported = this.moduleExportName();
        if (exported === null) return false;
      }
      specifiers.push({
        kind: exported === null ? "all" : "namespace",
        local: "*",
        exported,
        typeOnly,
        start,
        end: this.end,
      });
      return this.from(statement);
    }
    if (!this.eat(123)) return false;
    while (!this.eat(125)) {
      const start = this.skip();
      const named = this.typeModifier() || typeOnly;
      const local = this.moduleExportName();
      if (local === null) return false;
      let exported: string | null = local;
      if (this.eatWord("as")) exported = this.moduleExportName();
      if (exported === null) return false;
      specifiers.push({
        kind: "named",
        local,
        exported,
        typeOnly: named,
        start,
        end: this.end,
      });
      if (!this.eat(44) && this.at() !== 125) return false;
    }
    return this.from(statement);
  }

  /** Reads `type` before a specifier's name, as acorn-typescript does: when a string or a name other than `as` follows. */
  typeModifier(): boolean {
    if (!this.isWord("type")) return false;
    const next = this.peek(4);
    if (
      next === 34 ||
      next === 39 ||
      (isIdentifierStart(next) && !this.isWordAfter(4, "as"))
    ) {
      this.advance(4);
      return true;
    }
    return false;
  }

  /** Reads `= require("a")` or `= A.B` and the `;`. */
  importEquals(): boolean {
    this.advance(1);
    if (this.isWord("require") && this.peek(7) === 40) {
      this.advance(7);
      this.eat(40);
      if (this.string() === null || !this.eat(41)) return false;
    } else {
      do {
        if (this.name() === null) return false;
      } while (this.eat(46));
    }
    this.eat(59);
    return true;
  }

  from(statement: LexedImport | LexedExport): boolean {
    if (!this.eatWord("from")) return false;
    statement.source = this.string();
    return statement.source !== null && this.finish();
  }

  /** Reads the import attributes and the `;`. */
  finish(): boolean {
    let keyword = this.isWord("with") ? 4 : 0;
    if (
      this.isWord("assert") &&
      !hasLineBreak(this.source, this.end, this.pos)
    ) {
      keyword = 6;
    }
    if (keyword !== 0 && this.peek(keyword) === 123) {
      this.advance(keyword);
      this.eat(123);
      while (!this.eat(125)) {
        if (
          this.string() === null &&
          this.name() === null &&
          !this.eat(58) &&
          !this.eat(44)
        ) {
          return false;
        }
      }
    }
    this.eat(59);
    return true;
  }

  skip(): number {
    this.pos = skipTrivia(this.source, this.pos);
    return this.pos;
  }

  at(): number {
    return this.source.charCodeAt(this.skip());
  }

  /** Reads the token of `length` at the cursor, which is past trivia. */
  advance(length: number): void {
    this.pos += length;
    this.end = this.pos;
  }

  /** The code of the token after the one of `length` at the cursor. */
  peek(length: number): number {
    return this.source.charCodeAt(skipTrivia(this.source, this.pos + length));
  }

  isWordAfter(length: number, word: string): boolean {
    return isWordAt(
      this.source,
      skipTrivia(this.source, this.pos + length),
      word,
    );
  }

  eat(code: number): boolean {
    if (this.at() !== code) return false;
    this.advance(1);
    return true;
  }

  isWord(word: string): boolean {
    return isWordAt(this.source, this.skip(), word);
  }

  eatWord(word: string): boolean {
    if (!this.isWord(word)) return false;
    this.advance(word.length);
    return true;
  }

  moduleExportName(): string | null {
    return this.name() ?? this.string()?.value ?? null;
  }

  /** Reads a name, with its `\u` escapes decoded. */
  name(): string | null {
    const source = this.source;
    const start = this.skip();
    if (
      !isWordCode(source.charCodeAt(start)) ||
      isDigit(source.charCodeAt(start))
    ) {
      return null;
    }
    let value = "";
    let chunk = start;
    let i = start;
    while (i < source.length) {
      const code = source.charCodeAt(i);
      if (code === 92) {
        if (source.charCodeAt(i + 1) !== 117) return null;
        const escaped = this.unicodeEscape(i + 2);
        if (escaped === null) return null;
        value += source.slice(chunk, i) + escaped;
        i = chunk = this.escapeEnd;
      } else if (isWordCode(code)) {
        i++;
      } else {
        break;
      }
    }
    this.advance(i - start);
    return value + source.slice(chunk, i);
  }

  /** Reads a string literal, with its escapes decoded. */
  string(): LexedSource | null {
    const source = this.source;
    const start = this.skip();
    const quote = source.charCodeAt(start);
    if (quote !== 34 && quote !== 39) return null;
    let value = "";
    let chunk = start + 1;
    for (let i = chunk; i < source.length; ) {
      const code = source.charCodeAt(i);
      if (code === quote) {
        this.advance(i + 1 - start);
        return { value: value + source.slice(chunk, i), start, end: i + 1 };
      }
      if (code === 10 || code === 13) return null;
      if (code === 92) {
        const escaped = this.escape(i + 1);
        if (escaped === null) return null;
        value += source.slice(chunk, i) + escaped;
        i = chunk = this.escapeEnd;
      } else {
        i++;
      }
    }
    return null;
  }

  /** The text from `from` to `to` with its escapes decoded, and a template's `\r\n` and `\r` as `\n`, or `null` where acorn rejects an escape. */
  cooked(from: number, to: number, template: boolean): string | null {
    const source = this.source;
    let value = "";
    let chunk = from;
    for (let i = from; i < to; ) {
      const code = source.charCodeAt(i);
      if (code === 92) {
        const escaped = this.escape(i + 1);
        if (escaped === null) return null;
        value += source.slice(chunk, i) + escaped;
        i = chunk = this.escapeEnd;
      } else if (code === 13 && template) {
        value += `${source.slice(chunk, i)}\n`;
        i += source.charCodeAt(i + 1) === 10 ? 2 : 1;
        chunk = i;
      } else {
        i++;
      }
    }
    return value + source.slice(chunk, to);
  }

  /** The value of the escape after a `\` in a string, ending at `escapeEnd`, or `null` where acorn rejects it in a module. */
  escape(pos: number): string | null {
    const code = this.source.charCodeAt(pos);
    this.escapeEnd = pos + 1;
    switch (code) {
      case 110:
        return "\n";
      case 114:
        return "\r";
      case 116:
        return "\t";
      case 98:
        return "\b";
      case 118:
        return "\v";
      case 102:
        return "\f";
      case 48:
        return isDigit(this.source.charCodeAt(pos + 1)) ? null : "\0";
      case 120:
        return this.hexEscape(pos + 1, 2);
      case 117:
        return this.unicodeEscape(pos + 1);
      case 13:
        if (this.source.charCodeAt(pos + 1) === 10) this.escapeEnd++;
        return "";
      case 10:
      case 0x2028:
      case 0x2029:
        return "";
      default:
        return isDigit(code) || pos >= this.source.length
          ? null
          : String.fromCharCode(code);
    }
  }

  /** The value of `XXXX` or `{X…}` after `\u`, ending at `escapeEnd`. */
  unicodeEscape(pos: number): string | null {
    if (this.source.charCodeAt(pos) !== 123) return this.hexEscape(pos, 4);
    let value = 0;
    let i = pos + 1;
    for (; this.source.charCodeAt(i) !== 125; i++) {
      const digit = hexValue(this.source.charCodeAt(i));
      if (digit === -1) return null;
      value = value * 16 + digit;
      if (value > 0x10ffff) return null;
    }
    if (i === pos + 1) return null;
    this.escapeEnd = i + 1;
    return String.fromCodePoint(value);
  }

  hexEscape(pos: number, length: number): string | null {
    let value = 0;
    for (let i = pos; i < pos + length; i++) {
      const digit = hexValue(this.source.charCodeAt(i));
      if (digit === -1) return null;
      value = value * 16 + digit;
    }
    this.escapeEnd = pos + length;
    return String.fromCharCode(value);
  }
}

function isIdentifierStart(code: number): boolean {
  return code !== 92 && isWordCode(code) && !isDigit(code);
}

function hexValue(code: number): number {
  if (isDigit(code)) return code - 48;
  const lower = code | 32;
  return lower >= 97 && lower <= 102 ? lower - 87 : -1;
}

function hasLineBreak(source: string, start: number, end: number): boolean {
  for (let i = start; i < end; i++) {
    const code = source.charCodeAt(i);
    if (code === 10 || code === 13 || code === 0x2028 || code === 0x2029) {
      return true;
    }
  }
  return false;
}
