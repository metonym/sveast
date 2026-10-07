import type { BaseExpression, Expression, Node } from "./types/estree";

declare module "./types/estree" {
  interface ExpressionMap {
    ParenthesizedExpression: ParenthesizedExpression;
  }
}

interface ParenthesizedExpression extends BaseExpression {
  type: "ParenthesizedExpression";
  expression: Expression;
}

export function isNode(value: unknown): value is Node {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof fieldsOf(value).type === "string"
  );
}

export function fieldsOf(node: object): Record<string, unknown> {
  return node as Record<string, unknown>;
}

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

export function assertType<T extends { type: string }, K extends T["type"]>(
  node: T,
  ...types: K[]
): asserts node is Extract<T, { type: K }> {
  if (!types.some((type) => type === node.type)) {
    throw new Error(`expected ${types.join(" or ")}, got ${node.type}`);
  }
}
