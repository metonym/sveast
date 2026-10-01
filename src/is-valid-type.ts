import { Parser } from "acorn";
import { tsPlugin } from "./ts-plugin";

// biome-ignore lint/suspicious/noExplicitAny: `parseWholeType` isn't in acorn's published Parser type
const TypeParser: any = Parser.extend(tsPlugin);

/**
 * Whether `text` is exactly one TypeScript type, e.g. a JSDoc `{"sm" | "lg"}`
 * about to be copied into a `.d.ts`: the type on the right of
 * `type T = ...`, with nothing before or after it but whitespace and
 * comments. Parsed on its own, not wrapped in a statement, so a `;`, a line
 * break or a `}` in `text` can't end the type and start something else.
 *
 * A `//` comment runs to the end of the line: a caller that embeds `text`
 * before more code on the same line should check it for one.
 */
export function isValidType(text: string): boolean {
  const parser = new TypeParser(
    { ecmaVersion: 16, sourceType: "module" },
    text,
  );
  try {
    parser.parseWholeType();
    return true;
  } catch (error) {
    if (error instanceof SyntaxError) return false;
    throw error;
  }
}
