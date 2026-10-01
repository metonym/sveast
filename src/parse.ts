import { parseComponent } from "./component";
import { htmlEntityNames } from "./entity-names";
import type { ParseOptions } from "./options";
import type { AST } from "./types/svelte-ast";
import { TypeScriptParser } from "./typescript-parser";

const support = {
  typescript: TypeScriptParser,
  entityNames: htmlEntityNames,
};

/**
 * Parses a Svelte component into svelte's modern AST, the same as
 * `parse(source, { modern: true })` from svelte/compiler. From svelte's
 * `Parser` constructor (`phases/1-parse/index.js`).
 *
 * Throws a {@link ParseError} on a syntax error.
 */
export function parse(source: string, options?: ParseOptions): AST.Root {
  return parseComponent(source, options, support);
}
