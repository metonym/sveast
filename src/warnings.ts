// The warnings svelte's compiler gives besides the a11y ones, without
// svelte's compiler. svelte is MIT licensed.
import { componentWarnings } from "./component-warnings";
import { cssUnusedSelectors } from "./css-unused";
import { analyzeScopes, type Scopes } from "./scope";
import { templateWarnings } from "./template-warnings";
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
   * The component's source, as passed to {@link parse}. svelte reads it
   * to tell `<div/>` from `<div></div>`, which the AST doesn't.
   */
  source: string;
  /**
   * The component's file name, as svelte's `filename` option. It names
   * the self-import `svelte_self_deprecated` suggests: `Self` without one.
   */
  filename?: string;
  /**
   * Whether the component compiles as a custom element, as svelte's
   * `customElement` option. `<svelte:options customElement>` counts
   * without it, except for `options_missing_custom_element`. Default
   * `false`.
   */
  customElement?: boolean;
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
 * The codes it gives: `attribute_avoid_is`,
 * `attribute_global_event_reference`, `attribute_illegal_colon`,
 * `attribute_invalid_property_name`, `attribute_quoted`,
 * `bind_invalid_each_rest`, `block_empty`, `component_name_lowercase`,
 * `css_unused_selector`, `element_implicitly_closed`,
 * `element_invalid_self_closing_tag`, `event_directive_deprecated`,
 * `node_invalid_placement_ssr`, `options_deprecated_accessors`,
 * `options_deprecated_immutable`, `options_missing_custom_element`,
 * `script_context_deprecated`, `script_unknown_attribute`,
 * `slot_element_deprecated`, `svelte_component_deprecated`,
 * `svelte_element_invalid_this` and `svelte_self_deprecated`.
 *
 * `parse` records `element_implicitly_closed` and
 * `svelte_element_invalid_this` with the AST it returns, so a copy of
 * it gets neither.
 *
 * ```ts
 * import { isRunesMode, parse } from "sveast";
 * import { compilerWarnings } from "sveast/warnings";
 *
 * const warnings = compilerWarnings(parse(source), {
 *   source,
 *   runes: isRunesMode(source),
 * });
 * ```
 */
export function compilerWarnings(
  ast: AST.Root,
  options: CompilerWarningsOptions,
): CompilerWarning[] {
  const warnings: CompilerWarning[] = [];
  const runes = options.runes ?? false;
  let analysis: Scopes | undefined;
  const scopes = () => (analysis ??= analyzeScopes(ast));
  const push = (
    node: { start: number; end: number },
    code: string,
    message: string,
  ) => {
    warnings.push({ code, message, start: node.start, end: node.end });
  };
  templateWarnings(
    ast,
    {
      runes,
      source: options.source,
      filename: options.filename,
      customElement:
        (options.customElement ?? false) ||
        ast.options?.customElement !== undefined,
      scopes,
    },
    push,
  );
  cssUnusedSelectors(ast, runes, scopes, push);
  componentWarnings(ast, runes, options.customElement ?? false, push);
  return warnings;
}
