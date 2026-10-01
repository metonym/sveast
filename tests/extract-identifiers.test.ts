import {
  type AST,
  type AssignmentExpression,
  extractIdentifiers,
  type Identifier,
  isReference,
  type Pattern,
  parse,
  parseModule,
  SKIP,
  type TSParameterProperty,
  walk,
} from "sveast";
import { byCodeUnit } from "../scripts/shared";
import { corpusAsts } from "./corpus-asts";

type Binding = Pattern | TSParameterProperty | AssignmentExpression["left"];

function bindingsIn(ast: AST.SvelteNode): Binding[] {
  const patterns: Binding[] = [];
  walk(ast, {
    enter(node) {
      switch (node.type) {
        case "VariableDeclarator":
          patterns.push(node.id);
          break;
        case "FunctionDeclaration":
        case "FunctionExpression":
        case "ArrowFunctionExpression":
        case "TSDeclareFunction":
        case "TSDeclareMethod":
          patterns.push(...node.params);
          break;
        case "CatchClause":
          if (node.param) patterns.push(node.param);
          break;
        case "EachBlock":
          if (node.context) patterns.push(node.context);
          break;
        case "AwaitBlock":
          if (node.value) patterns.push(node.value);
          if (node.error) patterns.push(node.error);
          break;
        case "SnippetBlock":
          patterns.push(...node.parameters);
          break;
        case "AssignmentExpression":
          patterns.push(node.left);
          break;
      }
    },
  });
  return patterns;
}

const names = (patterns: Binding[]) =>
  patterns.flatMap(extractIdentifiers).map((identifier) => identifier.name);
const js = (source: string) => names(bindingsIn(parseModule(source)));
const ts = (source: string) =>
  names(bindingsIn(parseModule(source, { typescript: true })));

test("nested patterns, defaults and rest elements, in source order", () => {
  expect(js("let { a, b: [c, ...d], e = 1, ...f } = x;")).toEqual([
    "a",
    "c",
    "d",
    "e",
    "f",
  ]);
  expect(js("let [, a, , [b = c], ...[d, { e: f }]] = x;")).toEqual([
    "a",
    "b",
    "d",
    "f",
  ]);
  expect(js("let { [a]: b, c: { d = e } = {} } = x;")).toEqual(["b", "d"]);
});

test("returns the pattern's own nodes", () => {
  const program = parseModule("let { a, b: [c] } = x;");
  const [pattern] = bindingsIn(program);
  if (pattern?.type !== "ObjectPattern") throw new Error("expected a pattern");
  const [a, b] = pattern.properties;
  if (a?.type !== "Property" || b?.type !== "Property") {
    throw new Error("expected properties");
  }
  if (b.value.type !== "ArrayPattern") throw new Error("expected [c]");
  expect(extractIdentifiers(pattern)).toEqual([a.value, b.value.elements[0]]);
  expect(extractIdentifiers(pattern)[0]).toBe(a.value);
});

test("params and catch clauses", () => {
  expect(
    js(
      "function f(a, { b }, [c] = [], ...d) {} (e = 1) => {}; try {} catch ({ g }) {}",
    ),
  ).toEqual(["a", "b", "c", "d", "e", "g"]);
});

test("member expressions in assignments bind nothing", () => {
  expect(js("[a.b, c] = x; ({ d: e.f, g, ...h.i } = y); j[k] = z;")).toEqual([
    "c",
    "g",
  ]);
});

test("TypeScript: type wrappers on an assignment's target", () => {
  expect(
    ts(
      "a! = 1; (b as T) = 2; (c satisfies T) = 3; (<T>d) = 4; (e.f as T) = 5;",
    ),
  ).toEqual(["a", "b", "c", "d"]);
});

test("TypeScript: parameter properties and type annotations", () => {
  expect(
    ts(
      "class A { constructor(private a: T, public readonly b = 1, c?: U) {} }",
    ),
  ).toEqual(["a", "b", "c"]);
  expect(ts("function f(a: T, { b }: U, ...c: V[]): void {}")).toEqual([
    "a",
    "b",
    "c",
  ]);
  const [declared] = bindingsIn(parseModule("let a: T;", { typescript: true }));
  const [a] = extractIdentifiers(declared);
  expect(a?.typeAnnotation?.type).toBe("TSTypeAnnotation");
});

test("svelte: each, await and snippet bindings", () => {
  expect(
    names(
      bindingsIn(
        parse(
          "{#each items as { a, b: [c] }, i}{/each}{#await p then { d }}{:catch e}{/await}{#snippet s({ f }, g = 1)}{/snippet}",
        ),
      ),
    ),
  ).toEqual(["a", "c", "d", "e", "f", "g"]);
});

/** The identifiers under `pattern` outside keys, defaults, types and member expressions. */
function boundByWalking(pattern: Binding): Identifier[] {
  const found: Identifier[] = [];
  walk(pattern, {
    enter(node, parent, key) {
      if (
        (parent?.type === "AssignmentPattern" && key === "right") ||
        (parent?.type === "Property" && key === "key") ||
        key === "typeAnnotation" ||
        key === "decorators" ||
        node.type === "MemberExpression"
      ) {
        return SKIP;
      }
      if (node.type === "Identifier" && isReference(node, parent)) {
        found.push(node);
      }
    },
  });
  return found;
}

test("agrees with walking each pattern in the corpus", () => {
  const found = new Set<string>();
  let patterns = 0;
  for (const ast of corpusAsts()) {
    for (const pattern of bindingsIn(ast)) {
      patterns++;
      const extracted = extractIdentifiers(pattern);
      const walked = boundByWalking(pattern);
      if (
        extracted.length !== walked.length ||
        extracted.some((identifier, i) => identifier !== walked[i])
      ) {
        found.add(`${pattern.type} at ${pattern.start}`);
      }
    }
  }
  expect(patterns).toBeGreaterThan(1000);
  expect([...found].sort(byCodeUnit)).toEqual([]);
});
