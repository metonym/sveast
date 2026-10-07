import { resetNames } from "./names";
import type { Position } from "./types/estree";

export interface Location {
  line: number;
  column: number;
  character: number;
}

let source = "";
let lineStarts = [0];
let scanned = 0;
let lastLine = 0;
let breakEnds: number[] | null | undefined;

export function setSource(value: string): void {
  resetNames();
  source = value;
  lineStarts = [0];
  scanned = 0;
  lastLine = 0;
  breakEnds = undefined;
}

function scanTo(index: number): void {
  while (scanned <= index) {
    const newline = source.indexOf("\n", scanned);
    if (newline === -1) {
      scanned = Number.POSITIVE_INFINITY;
      return;
    }
    scanned = newline + 1;
    lineStarts.push(scanned);
  }
}

function lineStartsOf(text: string): number[] {
  const starts = [0];
  let i = text.indexOf("\n");
  while (i !== -1) {
    starts.push(i + 1);
    i = text.indexOf("\n", i + 1);
  }
  return starts;
}

function lineOf(starts: number[], index: number, hint: number): number {
  let low = 0;
  let high = starts.length - 1;
  if (index >= starts[hint]) low = hint;
  else high = hint - 1;
  if (low < high && index < starts[low + 1]) high = low;
  while (low < high) {
    const mid = (low + high + 1) >>> 1;
    if (starts[mid] <= index) low = mid;
    else high = mid - 1;
  }
  return low;
}

export function locate(index: number): Location {
  scanTo(index);
  lastLine = lineOf(lineStarts, index, lastLine);
  return {
    line: lastLine + 1,
    column: index - lineStarts[lastLine],
    character: index,
  };
}

const REGEX_LINE_BREAK = /\r\n?|\n|\u2028|\u2029/g;
const REGEX_OTHER_LINE_BREAK = /[\r\u2028\u2029]/;

export function lineBreaksBefore(offset: number): number {
  if (breakEnds === undefined) {
    breakEnds = REGEX_OTHER_LINE_BREAK.test(source) ? [] : null;
    REGEX_LINE_BREAK.lastIndex = 0;
    while (breakEnds !== null && REGEX_LINE_BREAK.exec(source) !== null) {
      breakEnds.push(REGEX_LINE_BREAK.lastIndex);
    }
  }
  if (breakEnds === null) {
    scanTo(offset);
    return lineOf(lineStarts, offset, lastLine);
  }
  let low = 0;
  let high = breakEnds.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (breakEnds[mid] <= offset) low = mid + 1;
    else high = mid;
  }
  return low;
}

export function position(index: number): { line: number; column: number } {
  const { line, column } = locate(index);
  return { line, column };
}

export function lineText(line: number): string | undefined {
  while (
    lineStarts.length <= line + 1 &&
    scanned !== Number.POSITIVE_INFINITY
  ) {
    scanTo(scanned);
  }
  if (line >= lineStarts.length) return undefined;
  const end =
    line + 1 < lineStarts.length ? lineStarts[line + 1] - 1 : source.length;
  return source.slice(lineStarts[line], end);
}

/**
 * A function from an offset in `text` to its line, from 1, and column,
 * from 0, in UTF-16 code units: what `loc: true` gives the node that
 * starts there, without parsing with `loc`. Lines end at `\n`, as in
 * svelte's markup `loc` and in `ParseError`; acorn's `loc` in
 * scripts and modules also ends them at a `\r` not followed by `\n`, at
 * U+2028 and at U+2029. `parse` drops a leading byte order mark, so pass
 * the text without it. Lines are found on the first call; lookups in
 * source order are fastest.
 *
 * ```ts
 * import { createLocator, parse, walk } from "sveast";
 *
 * const locate = createLocator(source);
 * walk(parse(source), {
 *   enter(node) {
 *     if (node.type === "Component") console.log(node.name, locate(node.start).line);
 *   },
 * });
 * ```
 */
export function createLocator(text: string): (offset: number) => Position {
  let starts: number[] | undefined;
  let last = 0;
  return (offset) => {
    starts ??= lineStartsOf(text);
    last = lineOf(starts, offset, last);
    return { line: last + 1, column: offset - starts[last] };
  };
}
