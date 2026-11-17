// What the parser saw that svelte warns about as it parses, which the AST
// can't show: an element a tag closed for it, and a `<svelte:element>`'s
// `this` attribute, which the AST keeps only as its tag.
import type { AST } from "./types/svelte-ast";

/** svelte's `element_implicitly_closed`: `by` closed the element, which wants `closing`. */
interface ImplicitClose {
  code: "element_implicitly_closed";
  start: number;
  end: number;
  by: string;
  closing: string;
}

/** svelte's `svelte_element_invalid_this`: `this="…"` on a `<svelte:element>`. */
interface InvalidThis {
  code: "svelte_element_invalid_this";
  start: number;
  end: number;
}

export type ParseWarning = ImplicitClose | InvalidThis;

const recorded = new WeakMap<AST.Root, ParseWarning[]>();

export function recordParseWarning(
  root: AST.Root,
  warning: ParseWarning,
): void {
  const warnings = recorded.get(root);
  if (warnings === undefined) recorded.set(root, [warning]);
  else warnings.push(warning);
}

/** What the parser recorded for `root`, in the order it parsed. */
export function parseWarnings(root: AST.Root): readonly ParseWarning[] {
  return recorded.get(root) ?? [];
}
