import {
  expected_token,
  unexpected_eof,
  unterminated_string_constant,
} from "./errors";

const DEFAULT_BRACKETS: Record<string, string> = {
  "{": "}",
  "(": ")",
  "[": "]",
};

export function matchBracket(
  source: string,
  start: number,
  brackets = DEFAULT_BRACKETS,
): number {
  const close = Object.values(brackets);
  const stack: string[] = [];

  let i = start;
  while (i < source.length) {
    const char = source[i++];

    if (char === "'" || char === '"' || char === "`") {
      i = matchQuote(source, i, char);
    } else if (Object.hasOwn(brackets, char)) {
      stack.push(char);
    } else if (close.includes(char)) {
      const expected = brackets[stack.pop() as string];
      if (char !== expected) expected_token(i - 1, expected);
      if (stack.length === 0) return i;
    }
  }

  unexpected_eof(source.length);
}

function matchQuote(source: string, start: number, quote: string): number {
  let i = start;
  while (i < source.length) {
    const char = source[i++];
    if (char === quote) return i;
    if (char === "\\") i++;
    else if (quote === "`" && char === "$" && source[i] === "{") {
      i = matchBracket(source, i);
    }
  }

  unterminated_string_constant(start);
}
