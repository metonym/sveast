import type { Position } from "./types/estree";

export interface Location {
  line: number;
  column: number;
  character: number;
}

let source = "";
let lineStarts: number[] | undefined;
let lastLine = 0;

export function setSource(value: string): void {
  source = value;
  lineStarts = undefined;
  lastLine = 0;
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

/** The 0-based line of `index`, searching from `hint`, the line found last. */
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
  lineStarts ??= lineStartsOf(source);
  lastLine = lineOf(lineStarts, index, lastLine);
  return {
    line: lastLine + 1,
    column: index - lineStarts[lastLine],
    character: index,
  };
}

export function position(index: number): { line: number; column: number } {
  const { line, column } = locate(index);
  return { line, column };
}

export function sourceLines(): string[] {
  return source.split("\n");
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
