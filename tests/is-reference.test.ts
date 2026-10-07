import { dirname } from "node:path";
import { type AST, isReference, parse, parseModule, walk } from "sveast";
import { byCodeUnit } from "../scripts/shared";
import { corpusAsts } from "./shared";

type IsReference = (node: AST.SvelteNode, parent: AST.SvelteNode) => boolean;

const svelteCompiler = Bun.resolveSync("svelte/compiler", import.meta.dir);
const upstream: { default: IsReference } = await import(
  Bun.resolveSync("is-reference", dirname(svelteCompiler))
);

const NOT_BINDINGS = new Set([
  "MetaProperty",
  "ImportAttribute",
  "ExportAllDeclaration",
]);

function referencesIn(ast: AST.SvelteNode): string[] {
  const seen = new Set<AST.SvelteNode>();
  const names: string[] = [];
  walk(ast, {
    enter(node, parent) {
      if (seen.has(node)) return;
      seen.add(node);
      if (node.type === "Identifier" && isReference(node, parent)) {
        names.push(node.name);
      }
    },
  });
  return names;
}

const js = (source: string) => referencesIn(parseModule(source));
const ts = (source: string) =>
  referencesIn(parseModule(source, { typescript: true }));

test("member expressions: the object, and a computed property", () => {
  expect(js("a.b; c[d]; e?.f; g.h.i;")).toEqual(["a", "c", "d", "e", "g"]);
});

test("object properties: the value, and a computed key", () => {
  expect(js("({ a: b, [c]: d, e, f() {}, get g() { return h; } });")).toEqual([
    "b",
    "c",
    "d",
    "e",
    "h",
  ]);
});

test("class members: computed keys and values", () => {
  expect(
    js("class A { b() {} [c]() {} d = e; [f] = g; #h = i; static { j; } }"),
  ).toEqual(["A", "c", "e", "f", "g", "i", "j"]);
});

test("imports and exports: the local side", () => {
  expect(
    js(
      'import a, { b as c, d } from "x"; import * as e from "x"; export { c as f, d }; export * as g from "x";',
    ),
  ).toEqual(["a", "c", "d", "e", "c", "d"]);
  expect(js('import a from "x" with { type: "json" };')).toEqual(["a"]);
});

test("labels, import.meta and new.target aren't references", () => {
  expect(js("a: for (;;) { break a; continue a; }")).toEqual([]);
  expect(js("import.meta.url; function f() { new.target; }")).toEqual(["f"]);
});

test("declarations are references", () => {
  expect(
    js("let { a, b: [c, ...d], e = f } = g; function h(i, j = k) {}"),
  ).toEqual(["a", "c", "d", "e", "f", "g", "h", "i", "j", "k"]);
});

test("a node other than an Identifier isn't a reference", () => {
  const program = parseModule("a.b;");
  expect(isReference(program, null)).toBe(false);
  expect(isReference(program.body[0], program)).toBe(false);
});

test("an Identifier without a parent is a reference", () => {
  const program = parseModule("a;");
  const statement = program.body[0];
  if (statement.type !== "ExpressionStatement") throw new Error("expected a");
  expect(isReference(statement.expression, null)).toBe(true);
});

test("TypeScript: names in types aren't references", () => {
  expect(
    ts(
      'let a: B<C.D> = e; type F = typeof g | H[I] | import("x").J; function k(l: M): l is N {}',
    ),
  ).toEqual(["a", "e", "k", "l"]);
  expect(
    ts("interface A extends B { c: D; e(f: G): void; [h: string]: I; }"),
  ).toEqual([]);
  expect(ts("class A implements B { c: D; e?(): void; }")).toEqual(["A"]);
  expect(ts("declare function f(a: B): void; namespace N {}")).toEqual([]);
});

test("TypeScript: expressions under type wrappers are references", () => {
  expect(ts("a as B; c satisfies D; e!; <F>g; h<I>; j!.k;")).toEqual([
    "a",
    "c",
    "e",
    "g",
    "h",
    "j",
  ]);
});

test("TypeScript: enums, parameter properties and import a = b", () => {
  expect(ts("enum A { B = c, D }")).toEqual(["A", "c"]);
  expect(ts("class A { constructor(private b: C, public d = e) {} }")).toEqual([
    "A",
    "b",
    "d",
    "e",
  ]);
  expect(ts('import a = b; import c = require("x"); export = d;')).toEqual([
    "a",
    "b",
    "c",
    "d",
  ]);
});

test("svelte: directive and tag expressions, block bindings", () => {
  expect(
    referencesIn(
      parse(
        "<script>let a = 1;</script>{#each items as { b, c: d }, i (b)}<input bind:value={a} on:click={e} use:f={g} class:h />{@debug a}{/each}{#snippet s(x)}{x}{/snippet}{@render s(a)}",
      ),
    ),
  ).toEqual([
    "a",
    "items",
    "b",
    "d",
    "b",
    "a",
    "e",
    "g",
    "h",
    "a",
    "s",
    "x",
    "x",
    "s",
    "a",
  ]);
});

test("agrees with is-reference on the corpus outside TypeScript nodes", () => {
  const found = new Set<string>();
  for (const ast of corpusAsts()) {
    walk(ast, {
      enter(node, parent, key) {
        if (node.type !== "Identifier" || parent === null) return;
        if (parent.type.startsWith("TS")) return;
        const expected =
          !NOT_BINDINGS.has(parent.type) && upstream.default(node, parent);
        if (isReference(node, parent) !== expected) {
          found.add(`${parent.type}.${key}`);
        }
      },
    });
  }
  expect([...found].sort(byCodeUnit)).toEqual([]);
});

test("under TypeScript nodes, only value positions are references", () => {
  const references = new Set<string>();
  for (const ast of corpusAsts()) {
    walk(ast, {
      enter(node, parent, key) {
        if (!parent?.type.startsWith("TS")) return;
        if (isReference(node, parent)) {
          references.add(`${parent.type}.${key}`);
        }
      },
    });
  }
  expect([...references].sort(byCodeUnit)).toEqual([
    "TSAsExpression.expression",
    "TSEnumDeclaration.id",
    "TSExportAssignment.expression",
    "TSImportEqualsDeclaration.id",
    "TSInstantiationExpression.expression",
    "TSNonNullExpression.expression",
    "TSParameterProperty.parameter",
    "TSSatisfiesExpression.expression",
    "TSTypeAssertion.expression",
  ]);
});
