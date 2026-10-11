import { lineOf, lineStartsOf } from "./locator";
import type { Position } from "./types/estree";

const MAX_TEXTS = 64;

interface Lines {
  starts: number[];
  last: number;
}

const linesByText = new Map<string, Lines>();

/**
 * The `{ line, column }` of `offset` in `text`, line from 1 and column
 * from 0, as {@link createLocator}'s function gives it, without keeping
 * a locator: the lines of the last 64 texts are kept, so calls for
 * several files in any order cost a lookup each after the first.
 *
 * ```ts
 * import { locate } from "sveast";
 *
 * `${file}:${locate(source, node.start).line}`;
 * ```
 */
export function locate(text: string, offset: number): Position {
  let lines = linesByText.get(text);
  if (lines === undefined) {
    if (linesByText.size >= MAX_TEXTS) {
      linesByText.delete(linesByText.keys().next().value as string);
    }
    lines = { starts: lineStartsOf(text), last: 0 };
    linesByText.set(text, lines);
  }
  const line = lineOf(lines.starts, offset, lines.last);
  lines.last = line;
  return { line: line + 1, column: offset - lines.starts[line] };
}
