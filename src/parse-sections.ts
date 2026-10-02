import { htmlEntityNames } from "./entity-names";
import type { ParseOptions } from "./options";
import { parseComponentSections } from "./sections";
import type { AST } from "./types/svelte-ast";
import { TypeScriptParser } from "./typescript-parser";

const support = {
  typescript: TypeScriptParser,
  entityNames: htmlEntityNames,
};

/**
 * Parses a component's top-level `<script>`s, `<style>` and
 * `<svelte:options>` as {@link parse} does, and skips the markup between
 * them as `lexComponent` skips it: `fragment` has no nodes, `comments`
 * only the scripts' comments, and errors in the markup aren't reported.
 * The rest is `parse`'s, offsets included. For a pass that only reads the
 * scripts, such as a component's props or its module script's exports.
 *
 * Throws a {@link ParseError} on a syntax error in a section.
 */
export function parseSections(
  source: string,
  options?: ParseOptions,
): AST.Root {
  return parseComponentSections(source, options, support);
}
