import type { Expression } from "./types/estree";
import type { AST } from "./types/svelte-ast";

/**
 * The value inside TypeScript's wrappers: `a` for `a as T`,
 * `a satisfies T`, `<T>a`, `a!`, `a<T>` and any nesting of them, such as
 * `(a as T)!`; `node` itself for anything else. For code that reads
 * values, such as an evaluator, so it doesn't need its own list of the
 * nodes that hold one.
 */
export function skipTypeWrappers(node: Expression): Expression;
export function skipTypeWrappers(node: AST.SvelteNode): AST.SvelteNode;
export function skipTypeWrappers(node: AST.SvelteNode): AST.SvelteNode {
  let inner = node;
  while (
    inner.type === "TSAsExpression" ||
    inner.type === "TSSatisfiesExpression" ||
    inner.type === "TSTypeAssertion" ||
    inner.type === "TSNonNullExpression" ||
    inner.type === "TSInstantiationExpression"
  ) {
    inner = inner.expression;
  }
  return inner;
}
