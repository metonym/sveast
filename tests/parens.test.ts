import { parse } from "sveast";
import { isRecord } from "../scripts/shared";

function parenthesizedCount(root: object): number {
  let count = 0;
  (function walk(node: unknown) {
    if (!isRecord(node)) return;
    if (node.type === "ParenthesizedExpression") count++;
    for (const key in node) {
      const value = node[key];
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object") walk(value);
    }
  })(root);
  return count;
}

function expressions(source: string) {
  return parse(source).fragment.nodes.flatMap((node) =>
    node.type === "ExpressionTag" ? [node.expression] : [],
  );
}

describe("ParenthesizedExpression unwrapping", () => {
  test("unwraps parens nested anywhere in a JS expression", () => {
    const source = "{(a)}{f((a))}{(a, b) => (c)}{x ? (y) : (z)}{[(a), ((b))]}";
    const nodes = expressions(source);
    expect(nodes).toHaveLength(5);
    expect(parenthesizedCount(nodes)).toBe(0);
    expect(nodes[0]).toMatchObject({ type: "Identifier" });
    expect(nodes[2]).toMatchObject({ body: { type: "Identifier" } });
  });

  test("leaves calls and arrows alone when there is nothing to unwrap", () => {
    const nodes = expressions("{f(a)}{(a) => a + 1}{new X(1)}");
    expect(parenthesizedCount(nodes)).toBe(0);
    expect(nodes.map((node) => node.type)).toEqual([
      "CallExpression",
      "ArrowFunctionExpression",
      "NewExpression",
    ]);
  });

  test("unwraps parens in TypeScript expressions", () => {
    const source =
      '<script lang="ts"></script>\n{(a as string)}{f<number>((x))}{((y as T)!)}';
    const nodes = expressions(source);
    expect(nodes).toHaveLength(3);
    expect(parenthesizedCount(nodes)).toBe(0);
  });
});
