// The warnings svelte's compiler gives besides the a11y ones, without
// svelte's compiler. svelte is MIT licensed.
import { cssUnusedSelectors } from "./css-unused";
import type { AST } from "./types/svelte-ast";

/** A warning svelte's compiler gives, with svelte's code, message and position. */
export interface CompilerWarning {
  /** svelte's code, such as `"css_unused_selector"`. */
  code: string;
  /** svelte's message: the reason, a line break, and the link to the warning's docs. */
  message: string;
  start: number;
  end: number;
}

export interface CompilerWarningsOptions {
  /**
   * Whether the component compiles in runes mode, as {@link isRunesMode}
   * says. It decides how `<!-- svelte-ignore -->` reads its codes: in
   * runes mode only svelte 5's codes, separated by commas, count; in
   * legacy mode svelte 4's codes do too. Default `false`.
   */
  runes?: boolean;
}

/**
 * The warnings svelte's compiler gives for a component besides the
 * `a11y_…` ones (see `sveast/a11y`), with the same codes, messages and
 * positions, and none that a `<!-- svelte-ignore -->` comment silences.
 * `ast` must come from {@link parse} with `css` left on.
 *
 * Today this is `css_unused_selector`: a selector in the component's
 * `<style>` that matches no element in its markup.
 *
 * ```ts
 * import { isRunesMode, parse } from "sveast";
 * import { compilerWarnings } from "sveast/warnings";
 *
 * const warnings = compilerWarnings(parse(source), { runes: isRunesMode(source) });
 * ```
 */
export function compilerWarnings(
  ast: AST.Root,
  options: CompilerWarningsOptions = {},
): CompilerWarning[] {
  const warnings: CompilerWarning[] = [];
  cssUnusedSelectors(ast, options.runes ?? false, (node, code, message) => {
    warnings.push({ code, message, start: node.start, end: node.end });
  });
  return warnings;
}
