import type { BaseExpression, Expression, Node } from "./types/estree";

/**
 * acorn's `preserveParens` option wraps a parenthesized expression in this
 * node. The parser removes them again, so the public types leave it out and
 * the module isn't reachable from them.
 */
declare module "./types/estree" {
  interface ExpressionMap {
    ParenthesizedExpression: ParenthesizedExpression;
  }
}

export interface ParenthesizedExpression extends BaseExpression {
  type: "ParenthesizedExpression";
  expression: Expression;
}

/** Whether `value` is an AST node: an object with a string `type`. */
export function isNode(value: unknown): value is Node {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof value.type === "string"
  );
}

/** A node's fields by name, for walking it without knowing its type. */
export function fieldsOf(node: object): Record<string, unknown> {
  return node as Record<string, unknown>;
}

/** Replaces each direct child node of `node` with what `map` returns for it. */
export function mapChildren(node: object, map: (child: Node) => Node): void {
  const fields = fieldsOf(node);
  for (const key in fields) {
    const value = fields[key];
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        if (isNode(value[i])) value[i] = map(value[i]);
      }
    } else if (isNode(value)) {
      fields[key] = map(value);
    }
  }
}

/** Throws unless `node` is one of `types`. For nodes that parsing a synthetic source guarantees. */
export function assertType<T extends { type: string }, K extends T["type"]>(
  node: T,
  ...types: K[]
): asserts node is Extract<T, { type: K }> {
  if (!types.some((type) => type === node.type)) {
    throw new Error(`expected ${types.join(" or ")}, got ${node.type}`);
  }
}
