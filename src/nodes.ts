import type {
  BaseExpression,
  BaseNode,
  Expression,
  Node,
} from "./types/estree";

/**
 * acorn puts `start` and `end` on every node, and acorn-typescript adds the
 * TypeScript nodes. svelte's published estree types omit both, so this widens
 * them for use inside the parser only: the module isn't reachable from the
 * public types.
 */
declare module "./types/estree" {
  interface BaseNode {
    start: number;
    end: number;
  }

  interface BasePattern {
    typeAnnotation?: TSTypeAnnotation;
  }

  interface ExpressionMap {
    ParenthesizedExpression: ParenthesizedExpression;
    TSAsExpression: TSAsExpression;
  }
}

/** A TypeScript type, which the parser never looks inside. */
export interface TSType extends BaseNode {
  type: string;
}

export interface TSTypeAnnotation extends BaseNode {
  type: "TSTypeAnnotation";
  typeAnnotation: TSType;
}

export interface TSAsExpression extends BaseExpression {
  type: "TSAsExpression";
  expression: Expression;
  typeAnnotation: TSType;
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

/** Throws unless `node` is a `type` node. For nodes that parsing a synthetic source guarantees. */
export function assertType<T extends { type: string }, K extends T["type"]>(
  node: T,
  type: K,
): asserts node is Extract<T, { type: K }> {
  if (node.type !== type) {
    throw new Error(`expected a ${type}, got a ${node.type}`);
  }
}
