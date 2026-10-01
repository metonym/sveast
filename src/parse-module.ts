import { parseProgram } from "./acorn-bridge";
import { setSource } from "./locator";
import type { Program } from "./types/estree";

/**
 * Parses a JavaScript or TypeScript module, e.g. a `.ts` file a component
 * imports, into the same kind of AST as a component's `<script>`:
 * estree, TypeScript nodes as in `@sveltejs/acorn-typescript`, and
 * comments attached as `leadingComments`/`trailingComments`.
 *
 * Throws a {@link ParseError} (`js_parse_error`) on a syntax error.
 */
export function parseModule(
  source: string,
  options: {
    /** Parse TypeScript. Default `false`. */
    typescript?: boolean;
    /** Add `loc` (line/column) to every node. Default `false`. */
    loc?: boolean;
  } = {},
): Program {
  setSource(source);
  return parseProgram(
    {
      isTypeScript: options.typescript ?? false,
      loc: options.loc ?? false,
      root: { comments: [] },
    },
    source,
  );
}
