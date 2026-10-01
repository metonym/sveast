import { parseModuleWith } from "./module";
import type { ParseModuleOptions } from "./options";
import type { Program } from "./types/estree";
import { TypeScriptParser } from "./typescript-parser";

export { ParseError } from "./parse-error";

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
  options: ParseModuleOptions = {},
): Program {
  return parseModuleWith(source, options, TypeScriptParser);
}
