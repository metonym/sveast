import { Parser } from "acorn";
import { isCommonType } from "./common-type";
import { tsPlugin } from "./ts-plugin";

// biome-ignore lint/suspicious/noExplicitAny: `parseWholeType` isn't in acorn's published Parser type
const TypeParser: any = Parser.extend(tsPlugin);

/**
 * Whether `text` is exactly one TypeScript type, e.g. a JSDoc `{"sm" | "lg"}`
 * about to be copied into a `.d.ts`: the type on the right of
 * `type T = ...`, with nothing before or after it but whitespace and
 * comments. Parsed on its own, not wrapped in a statement, so a `;`, a line
 * break or a `}` in `text` can't end the type and start something else.
 */
export function isValidType(
  text: string,
  options: {
    /**
     * `text` will be embedded before more code on the same line, e.g.
     * `CustomEvent<${text}>`: also require every `//` comment in it to end
     * with a line break, so it can't comment out what follows. Default
     * `false`.
     */
    inline?: boolean;
  } = {},
): boolean {
  return isCommonType(text) || parsesAsType(text, options.inline ?? false);
}

export function parsesAsType(text: string, inline: boolean): boolean {
  let lineCommentAtEnd = false;
  const parser = new TypeParser(
    inline
      ? {
          ecmaVersion: 16,
          sourceType: "module",
          onComment: (
            block: boolean,
            _text: string,
            _start: number,
            end: number,
          ) => {
            if (!block && end === text.length) lineCommentAtEnd = true;
          },
        }
      : { ecmaVersion: 16, sourceType: "module" },
    text,
  );
  try {
    parser.parseWholeType();
    return !lineCommentAtEnd;
  } catch (error) {
    if (error instanceof SyntaxError) return false;
    throw error;
  }
}
