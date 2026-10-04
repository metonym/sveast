import { type Location, lineText, locate } from "./locator";

export type NodeLike = number | { start?: number; end?: number } | null;

const REGEX_LEADING_TABS = /^\t+/;

/**
 * Thrown for a syntax error. `code`, `message`, `position`, `start`, `end`
 * and `frame` are what svelte/compiler's `CompileError` has for the same
 * input.
 */
export class ParseError extends Error {
  override name = "ParseError";
  /** svelte's error code, e.g. `"expected_token"` or `"block_unclosed"`. */
  code: string;
  /**
   * The message without svelte's link to the error's docs, e.g.
   * `"Unexpected token"`. `message` is always `reason`, a line break, then
   * the link, `https://svelte.dev/e/${code}`.
   */
  reason: string;
  /** `[start, end]` offsets into the source. */
  position?: [number, number];
  start?: Location;
  end?: Location;
  /** A few lines of source around the error, with a `^` under it. */
  frame?: string;

  constructor(node: NodeLike, code: string, reason: string) {
    super(`${reason}\nhttps://svelte.dev/e/${code}`);
    this.code = code;
    this.reason = reason;
    const start = typeof node === "number" ? node : node?.start;
    const end = typeof node === "number" ? node : node?.end;
    if (start !== undefined) {
      this.position = [start, end ?? start];
      this.start = locate(this.position[0]);
      this.end = locate(this.position[1]);
      this.frame = codeFrame(this.start.line - 1, this.end.column);
    }
  }
}

const tabsToSpaces = (text: string) =>
  text.replace(REGEX_LEADING_TABS, (match) => "  ".repeat(match.length));

function codeFrame(line: number, column: number): string {
  const frameStart = Math.max(0, line - 2);
  const lines: string[] = [];
  for (let i = frameStart; i < line + 3; i++) {
    const text = lineText(i);
    if (text === undefined) break;
    lines.push(text);
  }
  const frameEnd = frameStart + lines.length;
  const digits = String(frameEnd + 1).length;
  return lines
    .map((text, i) => {
      const lineNumber = String(i + frameStart + 1).padStart(digits, " ");
      if (frameStart + i !== line)
        return `${lineNumber}: ${tabsToSpaces(text)}`;
      const indicator = `${" ".repeat(digits + 2 + tabsToSpaces(text.slice(0, column)).length)}^`;
      return `${lineNumber}: ${tabsToSpaces(text)}\n${indicator}`;
    })
    .join("\n");
}
