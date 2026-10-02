const STATEMENT_START = 0;
const OPERATOR = 1;
const BLOCK_OPENER = 2;
const VALUE = 3;

const PAREN = 0;
const HEAD_PAREN = 1;
const BLOCK = 2;
const OBJECT = 3;
const TEMPLATE = 4;

const HEAD = 4;
const IMPORT = 5;
const EXPORT = 6;

const KEYWORDS: Record<string, number> = {
  await: OPERATOR,
  case: OPERATOR,
  default: OPERATOR,
  delete: OPERATOR,
  extends: OPERATOR,
  in: OPERATOR,
  instanceof: OPERATOR,
  new: OPERATOR,
  of: OPERATOR,
  return: OPERATOR,
  throw: OPERATOR,
  typeof: OPERATOR,
  void: OPERATOR,
  yield: OPERATOR,
  do: BLOCK_OPENER,
  else: BLOCK_OPENER,
  finally: BLOCK_OPENER,
  try: BLOCK_OPENER,
  for: HEAD,
  if: HEAD,
  while: HEAD,
  with: HEAD,
  import: IMPORT,
  export: EXPORT,
};
const LONGEST_KEYWORD = 10;
const KEYWORDS_BY_KEY: ([string, number][] | null)[] = new Array(
  keywordKey(128, 0),
).fill(null);
for (const entry of Object.entries(KEYWORDS)) {
  const key = keywordKey(entry[0].charCodeAt(0), entry[0].length);
  const entries = KEYWORDS_BY_KEY[key] ?? [];
  entries.push(entry);
  KEYWORDS_BY_KEY[key] = entries;
}

function keywordKey(first: number, length: number): number {
  return first * (LONGEST_KEYWORD + 1) + length;
}

/** The kind of the word from `start` to `end`: a keyword's, or `VALUE`. */
function wordKind(source: string, start: number, end: number): number {
  const first = source.charCodeAt(start);
  if (first >= 128 || end - start > LONGEST_KEYWORD) return VALUE;
  const key = keywordKey(first, end - start);
  const entries = KEYWORDS_BY_KEY[key];
  if (entries === null) return VALUE;
  for (let i = 0; i < entries.length; i++) {
    if (source.startsWith(entries[i][0], start)) return entries[i][1];
  }
  return VALUE;
}

const UNICODE_SPACE = /\s/;

const ASCII_WORD = new Uint8Array(128);
for (const range of ["az", "AZ", "09", "__", "$$", "\\\\"]) {
  for (let code = range.charCodeAt(0); code <= range.charCodeAt(1); code++) {
    ASCII_WORD[code] = 1;
  }
}

/** Whether `code` can be part of a word, read loosely: `false` past the end of the source, where `code` is `NaN`. */
export function isWordCode(code: number): boolean {
  return code >= 128
    ? !UNICODE_SPACE.test(String.fromCharCode(code))
    : ASCII_WORD[code] === 1;
}

function isSpaceCode(code: number): boolean {
  return code < 128
    ? code === 32 || (code >= 9 && code <= 13)
    : UNICODE_SPACE.test(String.fromCharCode(code));
}

/**
 * Calls `parseAt` with the start of each top-level `import` or `export`
 * statement, including the decorators before an `export`, and the offset of
 * its keyword, and resumes at the end it returns. With `localExports`
 * false, only exports with a `from` are parsed. The rest is skipped by a
 * tokenizer that only tracks strings, comments, templates, regular
 * expressions and brackets, and guesses regex or division from the
 * previous token, as acorn's does. It stops after the last `import` or
 * `export` word that could start a statement.
 */
export function scan(
  source: string,
  localExports: boolean,
  parseAt: (start: number, keyword: number) => number,
): void {
  const length = source.length;
  const last = lastStatementKeyword(source, localExports);
  const stack: number[] = [];
  let pos = source.startsWith("#!") ? lineEnd(source, 2) : 0;
  let prev = STATEMENT_START;
  let afterDot = false;
  let head = false;
  let decorators = -1;

  const statementEnd = () => {
    prev = STATEMENT_START;
    if (stack.length === 0) decorators = -1;
  };

  while (pos <= last) {
    const code = source.charCodeAt(pos);
    if (code === 32 || code === 10 || isSpaceCode(code)) {
      pos++;
      continue;
    }
    if (code === 47) {
      const next = source.charCodeAt(pos + 1);
      if (next === 47) {
        pos = lineEnd(source, pos + 2);
        continue;
      }
      if (next === 42) {
        const end = source.indexOf("*/", pos + 2);
        pos = end === -1 ? length : end + 2;
        continue;
      }
    }
    const wasAfterDot = afterDot;
    const wasHead = head;
    afterDot = false;
    head = false;

    if (isWordCode(code) || code === 35) {
      const start = pos;
      pos++;
      while (pos < length) {
        const next = source.charCodeAt(pos);
        if (next === 92) pos += 2;
        else if (isWordCode(next)) pos++;
        else break;
      }
      const kind = wasAfterDot ? VALUE : wordKind(source, start, pos);
      if (
        stack.length === 0 &&
        (kind === EXPORT
          ? localExports || isReexport(source, pos)
          : kind === IMPORT && isImportDeclaration(source, pos))
      ) {
        pos = Math.max(
          pos,
          parseAt(
            decorators !== -1 && kind === EXPORT ? decorators : start,
            start,
          ),
        );
        statementEnd();
      } else if (kind === EXPORT) {
        prev = BLOCK_OPENER;
      } else if (kind === HEAD) {
        head = true;
        prev = VALUE;
      } else {
        prev = kind === OPERATOR || kind === BLOCK_OPENER ? kind : VALUE;
      }
      continue;
    }

    pos++;
    switch (code) {
      case 34:
      case 39:
        pos = stringEnd(source, pos, code);
        prev = VALUE;
        break;
      case 96:
        pos = templateEnd(source, pos, stack);
        prev = source.charCodeAt(pos - 1) === 123 ? OPERATOR : VALUE;
        break;
      case 47: {
        const end = prev === VALUE ? -1 : regexEnd(source, pos);
        if (end === -1) {
          prev = OPERATOR;
        } else {
          pos = end;
          while (pos < length && isWordCode(source.charCodeAt(pos))) pos++;
          prev = VALUE;
        }
        break;
      }
      case 40:
        stack.push(wasHead ? HEAD_PAREN : PAREN);
        prev = OPERATOR;
        break;
      case 41:
        prev = stack.pop() === HEAD_PAREN ? BLOCK_OPENER : VALUE;
        break;
      case 123:
        stack.push(prev === OPERATOR ? OBJECT : BLOCK);
        prev = STATEMENT_START;
        break;
      case 125: {
        const open = stack.pop();
        if (open === TEMPLATE) {
          pos = templateEnd(source, pos, stack);
          prev = source.charCodeAt(pos - 1) === 123 ? OPERATOR : VALUE;
        } else if (open === OBJECT) prev = VALUE;
        else statementEnd();
        break;
      }
      case 59:
        statementEnd();
        break;
      case 93:
        prev = VALUE;
        break;
      case 46:
        if (isDigit(source.charCodeAt(pos))) {
          while (pos < length && isWordCode(source.charCodeAt(pos))) pos++;
          prev = VALUE;
        } else if (source.startsWith("..", pos)) {
          pos += 2;
          prev = OPERATOR;
        } else {
          afterDot = true;
          prev = OPERATOR;
        }
        break;
      case 63:
        if (
          source.charCodeAt(pos) === 46 &&
          !isDigit(source.charCodeAt(pos + 1))
        ) {
          pos++;
          afterDot = true;
        }
        prev = OPERATOR;
        break;
      case 33:
        prev =
          prev === VALUE && !isSpaceCode(source.charCodeAt(pos - 2))
            ? VALUE
            : OPERATOR;
        break;
      case 43:
      case 45:
        if (source.charCodeAt(pos) === code && prev === VALUE) pos++;
        else prev = OPERATOR;
        break;
      case 61:
        prev = source.charCodeAt(pos) === 62 ? BLOCK_OPENER : OPERATOR;
        if (prev === BLOCK_OPENER) pos++;
        break;
      case 64:
        if (stack.length === 0 && decorators === -1) decorators = pos - 1;
        prev = OPERATOR;
        break;
      default:
        prev = OPERATOR;
    }
  }
}

/**
 * The offset of the first `)` or `}` after `from` that closes no bracket
 * opened after it, such as the `}` that ends a template expression, read
 * with `scan`'s tokenizer: strings, comments, templates, regular
 * expressions and brackets are skipped. The source's length if there's
 * none. `word` is called with the offsets of each word that doesn't
 * follow `.` or `?.`, and returning `true` from it stops the scan there,
 * at -1.
 */
export function closingBracket(
  source: string,
  from: number,
  word?: (start: number, end: number) => boolean,
): number {
  const length = source.length;
  const stack: number[] = [];
  let pos = from;
  let prev = OPERATOR;
  let afterDot = false;

  while (pos < length) {
    const code = source.charCodeAt(pos);
    if (code === 32 || code === 10 || isSpaceCode(code)) {
      pos++;
      continue;
    }
    if (code === 47) {
      const next = source.charCodeAt(pos + 1);
      if (next === 47) {
        pos = lineEnd(source, pos + 2);
        continue;
      }
      if (next === 42) {
        const end = source.indexOf("*/", pos + 2);
        pos = end === -1 ? length : end + 2;
        continue;
      }
    }
    const wasAfterDot = afterDot;
    afterDot = false;

    if (isWordCode(code) || code === 35) {
      const start = pos;
      pos++;
      while (pos < length) {
        const next = source.charCodeAt(pos);
        if (next === 92) pos += 2;
        else if (isWordCode(next)) pos++;
        else break;
      }
      if (!wasAfterDot && word?.(start, pos)) return -1;
      const kind = wasAfterDot ? VALUE : wordKind(source, start, pos);
      prev =
        kind === OPERATOR || kind === BLOCK_OPENER || kind === HEAD
          ? OPERATOR
          : VALUE;
      continue;
    }

    pos++;
    switch (code) {
      case 34:
      case 39:
        pos = stringEnd(source, pos, code);
        prev = VALUE;
        break;
      case 96:
        pos = templateEnd(source, pos, stack);
        prev = source.charCodeAt(pos - 1) === 123 ? OPERATOR : VALUE;
        break;
      case 47: {
        const end = prev === VALUE ? -1 : regexEnd(source, pos);
        if (end === -1) {
          prev = OPERATOR;
        } else {
          pos = end;
          while (pos < length && isWordCode(source.charCodeAt(pos))) pos++;
          prev = VALUE;
        }
        break;
      }
      case 40:
        stack.push(PAREN);
        prev = OPERATOR;
        break;
      case 41:
        if (stack.length === 0) return pos - 1;
        stack.pop();
        prev = VALUE;
        break;
      case 123:
        stack.push(prev === OPERATOR ? OBJECT : BLOCK);
        prev = STATEMENT_START;
        break;
      case 125: {
        if (stack.length === 0) return pos - 1;
        const open = stack.pop();
        if (open === TEMPLATE) {
          pos = templateEnd(source, pos, stack);
          prev = source.charCodeAt(pos - 1) === 123 ? OPERATOR : VALUE;
        } else {
          prev = open === OBJECT ? VALUE : STATEMENT_START;
        }
        break;
      }
      case 93:
        prev = VALUE;
        break;
      case 46:
        if (isDigit(source.charCodeAt(pos))) {
          while (pos < length && isWordCode(source.charCodeAt(pos))) pos++;
          prev = VALUE;
        } else if (source.startsWith("..", pos)) {
          pos += 2;
          prev = OPERATOR;
        } else {
          afterDot = true;
          prev = OPERATOR;
        }
        break;
      case 63:
        if (
          source.charCodeAt(pos) === 46 &&
          !isDigit(source.charCodeAt(pos + 1))
        ) {
          pos++;
          afterDot = true;
        }
        prev = OPERATOR;
        break;
      case 33:
        prev =
          prev === VALUE && !isSpaceCode(source.charCodeAt(pos - 2))
            ? VALUE
            : OPERATOR;
        break;
      case 43:
      case 45:
        if (source.charCodeAt(pos) === code && prev === VALUE) pos++;
        else prev = OPERATOR;
        break;
      case 61:
        if (source.charCodeAt(pos) === 62) pos++;
        prev = OPERATOR;
        break;
      default:
        prev = OPERATOR;
    }
  }
  return length;
}

export function isDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

function lineEnd(source: string, pos: number): number {
  for (let i = pos; i < source.length; i++) {
    const code = source.charCodeAt(i);
    if (code === 10 || code === 13 || code === 0x2028 || code === 0x2029) {
      return i;
    }
  }
  return source.length;
}

/** The offset after the closing quote, or of the line break an unterminated string stops at. */
function stringEnd(source: string, pos: number, quote: number): number {
  for (let i = pos; i < source.length; i++) {
    const code = source.charCodeAt(i);
    if (code === quote) return i + 1;
    if (code === 92) {
      i += source.startsWith("\r\n", i + 1) ? 2 : 1;
    } else if (code === 10 || code === 13) return i;
  }
  return source.length;
}

/** The offset after the closing backtick, or after a `${`, which it pushes. */
function templateEnd(source: string, pos: number, stack: number[]): number {
  for (let i = pos; i < source.length; i++) {
    const code = source.charCodeAt(i);
    if (code === 96) return i + 1;
    if (code === 92) i++;
    else if (code === 36 && source.charCodeAt(i + 1) === 123) {
      stack.push(TEMPLATE);
      return i + 2;
    }
  }
  return source.length;
}

/** The offset after a regular expression's closing `/`, or -1 if the line ends first. */
function regexEnd(source: string, pos: number): number {
  let inClass = false;
  for (let i = pos; i < source.length; i++) {
    const code = source.charCodeAt(i);
    if (code === 10 || code === 13 || code === 0x2028 || code === 0x2029) {
      return -1;
    }
    if (code === 92) i++;
    else if (code === 91) inClass = true;
    else if (code === 93) inClass = false;
    else if (code === 47 && !inClass) return i + 1;
  }
  return -1;
}

/** The offset of the next token at or after `pos`, past whitespace and comments. */
export function skipTrivia(source: string, pos: number): number {
  for (let i = pos; i < source.length; i++) {
    const code = source.charCodeAt(i);
    if (isSpaceCode(code)) continue;
    if (code === 47) {
      const next = source.charCodeAt(i + 1);
      if (next === 47) {
        i = lineEnd(source, i + 2) - 1;
        continue;
      }
      if (next === 42) {
        const end = source.indexOf("*/", i + 2);
        if (end === -1) return source.length;
        i = end + 1;
        continue;
      }
    }
    return i;
  }
  return source.length;
}

export function isWordAt(source: string, pos: number, word: string): boolean {
  return (
    source.charCodeAt(pos) === word.charCodeAt(0) &&
    source.startsWith(word, pos) &&
    !isWordCode(source.charCodeAt(pos + word.length))
  );
}

/** Whether the `import` that ends at `pos` isn't `import(...)` or `import.meta`. */
function isImportDeclaration(source: string, pos: number): boolean {
  const code = source.charCodeAt(skipTrivia(source, pos));
  return code !== 40 && code !== 46;
}

/** Whether the `export` that ends at `pos` exports from another module: `export * from`, `export { a } from`, their `export type` forms, or `export import`. */
function isReexport(source: string, pos: number): boolean {
  let i = skipTrivia(source, pos);
  if (isWordAt(source, i, "import")) return true;
  if (isWordAt(source, i, "type")) i = skipTrivia(source, i + 4);
  const code = source.charCodeAt(i);
  if (code === 42) return true;
  if (code !== 123) return false;
  for (i++; i < source.length; i++) {
    const inner = source.charCodeAt(i);
    if (inner === 125) break;
    if (inner === 34 || inner === 39) i = stringEnd(source, i + 1, inner) - 1;
    else if (inner === 47) i = Math.max(i, skipTrivia(source, i) - 1);
  }
  return isWordAt(source, skipTrivia(source, i + 1), "from");
}

const STATEMENT_KEYWORD = /import|export/g;

/**
 * The offset of the last `import` or `export` word that `scan` would stop
 * at if it reached it, or -1. A regular expression finds the candidates:
 * `indexOf("export")` is several times slower, in V8 and JavaScriptCore.
 */
function lastStatementKeyword(source: string, localExports: boolean): number {
  let last = -1;
  STATEMENT_KEYWORD.lastIndex = 0;
  for (
    let match = STATEMENT_KEYWORD.exec(source);
    match !== null;
    match = STATEMENT_KEYWORD.exec(source)
  ) {
    const start = match.index;
    const end = start + 6;
    if (
      !isWordCode(source.charCodeAt(start - 1)) &&
      !isWordCode(source.charCodeAt(end)) &&
      (source.charCodeAt(start) === 105
        ? isImportDeclaration(source, end)
        : localExports || isReexport(source, end))
    ) {
      last = start;
    }
  }
  return last;
}
