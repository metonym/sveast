import {
  type AST,
  type Identifier,
  type Program,
  parse,
  parseModule,
  SKIP,
  valueVisitorKeys,
  visitorKeys,
  walk,
} from "sveast";
import {
  analyzeScopes,
  type Binding,
  type Reference,
  type Scopes,
} from "sveast/scope";
import { attempt, SVELTE_FILES } from "../scripts/shared";
import { compareScopes } from "../scripts/svelte-scopes";
import { corpusAsts, corpusFiles, readCorpus } from "./shared";

test("resolves names as svelte's analyzer does on the corpus", () => {
  let compared = 0;
  let stores = 0;
  for (const path of corpusFiles(SVELTE_FILES)) {
    const result = compareScopes(readCorpus(path));
    if (!result) continue;
    compared += result.compared;
    stores += result.stores;
    expect([path, result.mismatches]).toEqual([path, []]);
  }
  expect(compared).toBeGreaterThan(30_000);
  expect(stores).toBeGreaterThan(10);
});

function analyze(source: string, types = false) {
  const ast = parse(source);
  const scopes = analyzeScopes(ast, { types });
  const named = (name: string, nth = 0): Identifier => {
    const found: Identifier[] = [];
    walk(ast, {
      enter(node) {
        if (node.type === "Identifier" && node.name === name) found.push(node);
      },
    });
    const match = found[nth];
    if (!match) throw new Error(`no ${name} #${nth}`);
    return match;
  };
  const uses = (binding: Binding | null) =>
    binding?.references.map((reference) => {
      const flags = [
        reference.reads && "read",
        reference.writes && "write",
        reference.mutates && "mutate",
        reference.store && "store",
        reference.type && "type",
      ].filter(Boolean);
      return `${reference.node.name}@${reference.node.start} ${flags.join(" ")}`;
    });
  return { ast, scopes, named, uses };
}

test("keeps a top-level name apart from the nested ones that reuse it", () => {
  const { scopes, named } = analyze(`<script>
  export let size = "md";
  function f(size) { return size; }
  const g = () => { let size = 1; return size; };
</script>
{#each sizes as size}{size}{/each}
{size}`);
  const top = scopes.instance.get("size");
  expect(top?.prop).toBe("size");
  expect(top?.references.map((reference) => reference.node)).toEqual([
    named("size", 7),
  ]);
  expect(scopes.bindingOf(named("size", 2))?.kind).toBe("param");
  expect(scopes.bindingOf(named("size", 4))?.kind).toBe("let");
  expect(scopes.bindingOf(named("size", 4))).not.toBe(top);
  expect(scopes.bindingOf(named("size", 6))?.kind).toBe("each");
});

test("binds the renamed name of let:", () => {
  const { scopes, named } = analyze(`<script>let direction = "top";</script>
<Tooltip let:direction={actual}>{actual} {direction}</Tooltip>
<Tooltip let:direction>{direction}</Tooltip>
<Menu let:item={{ id, label: text }}>{id}{text}</Menu>`);
  const actual = scopes.bindingOf(named("actual", 1));
  expect(actual?.kind).toBe("let-directive");
  expect(actual?.node).toBe(named("actual", 0));
  expect(scopes.bindingOf(named("direction", 1))).toBe(
    scopes.instance.get("direction"),
  );
  const shorthand = scopes.bindingOf(named("direction", 2));
  expect(shorthand?.kind).toBe("let-directive");
  expect(shorthand?.node).toBeNull();
  expect(shorthand?.declaration.type).toBe("LetDirective");
  expect(scopes.bindingOf(named("text", 1))?.kind).toBe("let-directive");
  expect(scopes.bindingOf(named("id", 1))?.kind).toBe("let-directive");
});

test("scopes let: to a component's default or named slot", () => {
  const { scopes, named } = analyze(`<List let:item>
  {item}
  <div slot="footer">{item}</div>
  <Inner slot="header" let:item={row}>{row}</Inner>
</List>`);
  expect(scopes.bindingOf(named("item", 0))?.kind).toBe("let-directive");
  expect(scopes.bindingOf(named("item", 1))).toBeNull();
  expect(scopes.bindingOf(named("row", 1))?.kind).toBe("let-directive");
});

test("declares an each block's item and index for its key and body", () => {
  const { ast, scopes, named } = analyze(
    "{#each items as { id, ...rest }, i (id)}{id}{rest}{i}{:else}{i}{/each}",
  );
  const block = ast.fragment.nodes[0];
  if (block.type !== "EachBlock") throw new Error(block.type);
  expect([...scopes.declaredIn(block).keys()]).toEqual(["id", "rest", "i"]);
  expect(scopes.bindingOf(named("id", 0))).toBeNull();
  expect(scopes.bindingOf(named("id", 2))?.node).toBe(named("id", 1));
  expect(scopes.bindingOf(named("id", 3))?.node).toBe(named("id", 1));
  const index = scopes.declaredIn(block).get("i");
  expect(index?.kind).toBe("each-index");
  expect(index?.node).toBeNull();
  expect(index?.references).toHaveLength(1);
  expect(scopes.scopeOf(block)?.get("i")).toBeNull();
});

test("declares snippets, their parameters, {@const} and {:then}", () => {
  const { scopes, named } = analyze(`{#snippet row(item, { label = item.name })}
  {@const upper = label.toUpperCase()}
  {upper}{item}
{/snippet}
{@render row(first)}
{#await load then value}{value}{:catch error}{error}{/await}`);
  const row = scopes.bindingOf(named("row", 1));
  expect(row?.kind).toBe("snippet");
  expect(row?.node).toBe(named("row", 0));
  expect(scopes.bindingOf(named("item", 1))?.kind).toBe("snippet-param");
  expect(scopes.bindingOf(named("label", 1))?.kind).toBe("snippet-param");
  const upper = scopes.bindingOf(named("upper", 1));
  expect(upper?.kind).toBe("const-tag");
  expect(upper?.initial?.type).toBe("CallExpression");
  expect(scopes.bindingOf(named("value", 1))?.kind).toBe("await-value");
  expect(scopes.bindingOf(named("error", 1))?.kind).toBe("await-error");
  expect(scopes.bindingOf(named("first"))).toBeNull();
});

test("records reads, writes, mutations and bind: targets", () => {
  const { scopes, uses } = analyze(`<script>
  let a = 1, b = {}, c = 0;
  a = 2; a += 1; b.x = a; b[a]++; [a, b.y] = [c]; for (c of []) {}
</script>
<input bind:value={a} /><input bind:value={b.z} />`);
  expect(uses(scopes.instance.get("a"))).toEqual([
    "a@39 write",
    "a@46 read write",
    "a@60 read",
    "a@65 read",
    "a@72 write",
    "a@133 read write",
  ]);
  expect(uses(scopes.instance.get("b"))).toEqual([
    "b@54 read mutate",
    "b@63 read mutate",
    "b@75 read mutate",
    "b@157 read mutate",
  ]);
  expect(uses(scopes.instance.get("c"))).toEqual(["c@83 read", "c@92 write"]);
});

test("reads a store through its $ subscription", () => {
  const { scopes, uses } = analyze(`<script>
  import { writable } from "svelte/store";
  const count = writable(0);
  const state = writable(0);
  $count = 1;
  function f($count) { return $count; }
</script>
{$count}{$state}{$page}`);
  expect(uses(scopes.instance.get("count"))).toEqual([
    "$count@112 read mutate store",
    "$count@175 read store",
  ]);
  expect(uses(scopes.instance.get("state"))).toEqual(["$state@183 read store"]);
  expect(scopes.instance.get("$count")).toBeNull();
});

test("records the rune that initializes a binding and the props it declares", () => {
  const { scopes } = analyze(`<script>
  let { size = "md", class: klass, open = $bindable(false), ...rest } = $props();
  let count = $state(0);
  let double = $derived(count * 2);
  let items = $state.raw([]);
  const id = $props.id();
</script>`);
  const get = (name: string) => scopes.instance.get(name);
  expect(get("size")).toMatchObject({ rune: "$props", prop: "size" });
  expect(get("size")?.initial).toMatchObject({ type: "Literal", value: "md" });
  expect(get("klass")).toMatchObject({ rune: "$props", prop: "class" });
  expect(get("klass")?.initial).toBeNull();
  expect(get("open")?.initial).toMatchObject({ value: false });
  expect(get("rest")).toMatchObject({ rune: "$props", prop: null });
  expect(get("count")?.rune).toBe("$state");
  expect(get("double")?.rune).toBe("$derived");
  expect(get("items")?.rune).toBe("$state.raw");
  expect(get("id")?.rune).toBe("$props.id");
});

test("doesn't take a shadowed rune or a store for a rune", () => {
  const { scopes } = analyze(`<script>
  import { writable } from "svelte/store";
  const state = writable(0);
  let a = $state(1);
  function f($derived) { let b = $derived(1); }
</script>`);
  expect(scopes.instance.get("a")?.rune).toBeNull();
  const f = scopes.instance.get("f")?.declaration;
  if (f?.type !== "FunctionDeclaration") throw new Error("no f");
  expect(scopes.declaredIn(f.body).get("b")?.rune).toBeNull();
});

test("finds legacy props, $: declarations and directive names", () => {
  const { ast, scopes, uses } = analyze(`<script>
  import { fade } from "svelte/transition";
  let color = "red";
  let klass = "";
  export { klass as class };
  export const version = 1;
  $: doubled = color.length * 2;
  const tooltip = () => {};
</script>
<p use:tooltip.x transition:fade style:color>{doubled}</p>
<Foo.Bar in:fade out:fade />`);
  expect(scopes.instance.get("klass")?.prop).toBe("class");
  expect(scopes.instance.get("version")?.prop).toBeNull();
  const doubled = scopes.instance.get("doubled");
  expect(doubled?.kind).toBe("reactive");
  expect(doubled?.initial?.type).toBe("BinaryExpression");
  expect(uses(doubled)).toEqual(["doubled@154 write", "doubled@266 read"]);
  expect(uses(scopes.instance.get("tooltip"))).toEqual(["tooltip@227 read"]);
  expect(uses(scopes.instance.get("fade"))).toEqual([
    "fade@248 read",
    "fade@291 read",
    "fade@300 read",
  ]);
  const color = scopes.instance.get("color")?.references.at(-1);
  expect(color?.node).toMatchObject({ name: "color", start: 259, end: 264 });
  expect(color?.parent.type).toBe("StyleDirective");
  const p = ast.fragment.nodes[1];
  if (p.type !== "RegularElement" || !color) throw new Error(p.type);
  expect(scopes.scopeOf(color.node)).toBe(scopes.scopeOf(p.attributes[2]));
});

test("resolves JavaScript's scopes", () => {
  const { scopes, named } = analyze(`<script>
  var hoisted;
  {
    let inner = 1;
    var lifted = inner;
    function local() {}
  }
  const named = function self() { return self; };
  const Klass = class Self { m() { return Self; } };
  try {} catch ({ message }) { message; }
  for (let i = 0; i < 1; i++) i;
  label: for (;;) break label;
</script>`);
  expect([...scopes.instance.declarations.keys()]).toEqual([
    "hoisted",
    "lifted",
    "named",
    "Klass",
  ]);
  expect(scopes.bindingOf(named("self", 1))?.kind).toBe("function");
  expect(scopes.bindingOf(named("Self", 1))?.kind).toBe("class");
  expect(scopes.bindingOf(named("message", 1))?.kind).toBe("catch");
  expect(scopes.bindingOf(named("i", 3))?.kind).toBe("let");
  expect(scopes.bindingOf(named("local"))?.scope.node?.type).toBe(
    "BlockStatement",
  );
  expect(scopes.bindingOf(named("label", 1))).toBeNull();
});

test("skips TypeScript's types", () => {
  const { scopes, uses } = analyze(`<script lang="ts">
  import type { Size } from "./types";
  type S = typeof size;
  interface P { size: Size }
  let size: Size = "md";
  const a = size as S;
  const b = size!;
  enum E { A = 1, B = A }
  function f(this: Window, x: typeof size) {}
</script>`);
  expect(uses(scopes.instance.get("size"))).toEqual([
    "size@148 read",
    "size@171 read",
  ]);
  expect(scopes.instance.get("S")).toBeNull();
  expect(scopes.instance.get("P")).toBeNull();
  expect(scopes.instance.getType("P")).toBeNull();
  expect(scopes.instance.types.size).toBe(0);
  expect(scopes.instance.get("E")?.kind).toBe("enum");
  const f = scopes.instance.get("f")?.declaration;
  if (f?.type !== "FunctionDeclaration") throw new Error("no f");
  expect([...scopes.declaredIn(f).keys()]).toEqual(["x"]);
});

test("visits a snippet parameter's parenthesized default", () => {
  const { scopes, named } = analyze(
    "<script>let c = 1;</script>{#snippet row(a, b = (c, a))}{b}{/snippet}",
  );
  expect(scopes.bindingOf(named("c", 1))).toBe(scopes.instance.get("c"));
  expect(scopes.bindingOf(named("a", 1))?.kind).toBe("snippet-param");
});

test("gives an identifier's reference", () => {
  const { scopes, named } = analyze(`<script>
  import { writable } from "svelte/store";
  const count = writable(0);
  $: ({ a, b: c } = $count);
</script>
{a}{c}{window}`);
  expect(scopes.referenceOf(named("count", 0))).toBeNull();
  const store = scopes.referenceOf(named("$count"));
  expect(store).toMatchObject({ store: true, reads: true, writes: false });
  expect(store?.binding).toBe(scopes.instance.get("count"));
  const a = scopes.instance.get("a");
  expect(a?.kind).toBe("reactive");
  expect(scopes.referenceOf(named("a", 1))).toMatchObject({
    writes: true,
    binding: a,
  });
  expect(scopes.referenceOf(named("a", 2))).toMatchObject({
    reads: true,
    binding: a,
  });
  expect(scopes.referenceOf(named("b"))).toBeNull();
  expect(scopes.referenceOf(named("window"))).toMatchObject({ binding: null });
});

test("analyzes a module", () => {
  const ast = parseModule(
    "let a = $state(0);\nexport function f(b) { return a + b + $c; }",
  );
  const scopes = analyzeScopes(ast);
  expect(scopes.instance).toBe(scopes.module);
  expect(scopes.module.node).toBe(ast);
  expect(scopes.module.get("a")?.rune).toBe("$state");
  expect(scopes.module.get("a")?.references).toHaveLength(1);
  const f = scopes.module.get("f")?.declaration;
  if (f?.type !== "FunctionDeclaration") throw new Error("no f");
  expect(scopes.scopeOf(f)).toBe(scopes.module);
  expect([...scopes.declaredIn(f).keys()]).toEqual(["b"]);
});

test("gives every node outside types and styles a scope", () => {
  for (const path of corpusFiles(SVELTE_FILES)) {
    const ast = attempt(() => parse(readCorpus(path)));
    if (!ast) continue;
    const scopes = analyzeScopes(ast);
    const missing: string[] = [];
    walk(
      ast,
      {
        enter(node) {
          if (node.type === "StyleSheet") return SKIP;
          if (scopes.scopeOf(node) === null) {
            missing.push(`${node.type}@${"start" in node ? node.start : ""}`);
          }
          return;
        },
      },
      valueVisitorKeys,
    );
    expect([path, missing]).toEqual([path, []]);
  }
});

test("gives scopes that resolve names to its own bindings", () => {
  const { scopes, named } = analyze(
    `<script>
  let act = () => {};
  function f(a) { return a; }
</script>
{#each [1] as item}<p use:act={item}>{item}</p>{/each}`,
  );
  const reads = [named("a", 1), named("item", 2)];
  for (const node of reads) {
    expect(scopes.scopeOf(node)?.get(node.name)).toBe(scopes.bindingOf(node));
  }
  const act = scopes.instance.get("act");
  const directive = act?.references.find(
    (reference) => reference.parent.type === "UseDirective",
  );
  if (!directive) throw new Error("no use:act reference");
  expect(scopes.scopeOf(directive.node)?.get("act")).toBe(act);
  expect(scopes.scopeOf(named("f"))).toBe(scopes.instance);
});

test("resolves the names in types with { types: true }", () => {
  const { scopes, uses } = analyze(
    `<script lang="ts">
  import type { DataTableHeader } from "carbon-components-svelte";
  import { type Size, Button } from "./ui";
  import * as UI from "./ui";
  let headers: DataTableHeader[] = [];
  type Props = { size: Size; kind: UI.Kind; of: typeof headers };
  interface Item extends Props { id: string }
  class Row implements Item { size!: Size; kind!: UI.Kind; of = headers; id = ""; }
  const Props = 1;
  export type { Props };
</script>
<Button {headers} />`,
    true,
  );
  const get = (name: string) => scopes.instance.get(name);
  const type = (name: string) => scopes.instance.getType(name);
  expect(uses(get("DataTableHeader"))).toEqual(["DataTableHeader@175 type"]);
  expect(uses(get("Size"))).toEqual(["Size@222 type", "Size@348 type"]);
  expect(uses(get("UI"))).toEqual(["UI@234 type", "UI@361 type"]);
  expect(uses(get("headers"))).toEqual([
    "headers@254 type",
    "headers@375 read",
    "headers@458 read",
  ]);
  expect(uses(get("Button"))).toEqual(["Button@450 read"]);
  expect(type("Props")).toMatchObject({ kind: "type", name: "Props" });
  expect(type("Props")?.initial?.type).toBe("TSTypeAliasDeclaration");
  expect(get("Props")?.kind).toBe("const");
  expect(uses(type("Props"))).toEqual(["Props@290 type", "Props@430 type"]);
  expect(uses(get("Props"))).toEqual([]);
  expect(uses(type("Item"))).toEqual(["Item@334 type"]);
  expect(type("Row")).toBe(get("Row"));
  expect(type("Size")).toBe(get("Size"));
  expect([...scopes.instance.types.keys()]).toEqual(["Props", "Item"]);
  expect(scopes.instance.declarations.has("Item")).toBe(false);
});

test("scopes type parameters, infer and mapped types", () => {
  const { ast, scopes, named } = analyze(
    `<script lang="ts">
  function f<T extends K, K>(a: T, b: K): T { let c: T = a; return c; }
  class Box<T> { get<U extends T>(u: U): [T, U] { return [null!, u]; } }
  type Head<L> = L extends [infer H, ...unknown[]] ? H : L;
  type Keys<O> = { [P in keyof O as \`on\${P & string}\`]: O[P] };
  type Fn = <R>(x: R, ...rest: R[]) => x is R & typeof x;
  const T = 1;
</script>`,
    true,
  );
  const typeParam = (name: string, nth: number) => {
    const binding = scopes.bindingOf(named(name, nth));
    expect(binding?.kind).toBe("type-param");
    expect(binding?.node).toBeNull();
    expect(binding?.declaration.type).toBe("TSTypeParameter");
    return binding;
  };
  const t = typeParam("T", 0);
  expect(typeParam("T", 1)).toBe(t);
  expect(typeParam("T", 2)).toBe(t);
  expect(typeParam("K", 0)).toBe(typeParam("K", 1));
  const script = ast.instance?.content.body[0];
  if (script?.type !== "FunctionDeclaration") throw new Error("no f");
  expect(scopes.scopeOf(script.body)?.getType("T")).toBe(t);
  expect([...scopes.declaredIn(script).keys()]).toEqual(["a", "b"]);
  const box = typeParam("T", 3);
  expect(box).not.toBe(t);
  expect(typeParam("T", 4)).toBe(box);
  expect(typeParam("U", 0)).toBe(typeParam("U", 1));
  expect(typeParam("H", 0)?.scope.node?.type).toBe("TSConditionalType");
  expect(typeParam("L", 1)?.scope.node?.type).toBe("TSTypeAliasDeclaration");
  expect(typeParam("P", 0)?.scope.node?.type).toBe("TSMappedType");
  expect(typeParam("P", 1)).toBe(typeParam("P", 0));
  expect(typeParam("O", 0)).toBe(typeParam("O", 1));
  expect(typeParam("R", 0)).toBe(typeParam("R", 2));
  const x = scopes.bindingOf(named("x", 0));
  expect(x).toMatchObject({ kind: "param" });
  expect(x?.declaration.type).toBe("TSFunctionType");
  expect(scopes.bindingOf(named("x", 1))).toBe(x);
  expect(scopes.bindingOf(named("x", 2))).toBe(x);
  expect(scopes.instance.get("T")?.references).toEqual([]);
});

test("doesn't take a type's property names for references", () => {
  const { scopes, uses } = analyze(
    `<script lang="ts">
  const key = "k", size = 1, method = 2;
  type A = { size: number; method(): void; [key]: string; [k: string]: unknown };
  interface B { [key](): void; size: typeof size }
</script>`,
    true,
  );
  expect(uses(scopes.instance.get("size"))).toEqual(["size@186 type"]);
  expect(uses(scopes.instance.get("method"))).toEqual([]);
  expect(uses(scopes.instance.get("key"))).toEqual([
    "key@104 type",
    "key@159 type",
  ]);
  expect(scopes.instance.get("k")).toBeNull();
});

test("resolves a name in a type to its value with typeof and to a namespace in N.T", () => {
  const { scopes, uses } = analyze(
    `<script lang="ts">
  namespace N { export type T = 1; export const v = 1; }
  enum E { A }
  type X = N.T | typeof N.v | E.A | E;
  let n: import("./n").N;
</script>`,
    true,
  );
  expect(uses(scopes.instance.get("N"))).toEqual(["N@102 type", "N@115 type"]);
  expect(uses(scopes.instance.get("E"))).toEqual(["E@121 type", "E@127 type"]);
  expect(scopes.instance.get("n")?.references).toEqual([]);
});

test("gives every node a scope with { types: true }", () => {
  for (const ast of corpusAsts()) {
    if (ast.type !== "Root" && ast.type !== "Program") continue;
    const scopes = analyzeScopes(ast, { types: true });
    const missing: string[] = [];
    walk(
      ast,
      {
        enter(node) {
          if (node.type === "StyleSheet") return SKIP;
          if (scopes.scopeOf(node) === null) {
            missing.push(`${node.type}@${"start" in node ? node.start : ""}`);
          }
          return;
        },
      },
      visitorKeys,
    );
    expect(missing).toEqual([]);
  }
});

test("resolves values the same with { types: true }", () => {
  const describe = (reference: Reference | null) =>
    reference && {
      reads: reference.reads,
      writes: reference.writes,
      mutates: reference.mutates,
      store: reference.store,
      binding: reference.binding && {
        name: reference.binding.name,
        kind: reference.binding.kind,
        node: reference.binding.node,
      },
    };
  const valueReferences = (ast: AST.Root | Program, scopes: Scopes) => {
    const found: [Identifier, Reference][] = [];
    walk(ast, {
      enter(node) {
        if (node.type !== "Identifier") return;
        const reference = scopes.referenceOf(node);
        if (reference && !reference.type) found.push([node, reference]);
      },
    });
    return found;
  };
  let typed = 0;
  for (const ast of corpusAsts()) {
    if (ast.type !== "Root" && ast.type !== "Program") continue;
    const values = analyzeScopes(ast);
    const types = analyzeScopes(ast, { types: true });
    const fromValues = valueReferences(ast, values);
    const fromTypes = valueReferences(ast, types);
    expect(fromTypes.map(([node]) => node)).toEqual(
      fromValues
        .map(([node]) => node)
        .filter((node) => !types.referenceOf(node)?.type),
    );
    for (const [node, reference] of fromTypes) {
      expect(describe(reference)).toEqual(describe(values.referenceOf(node)));
    }
    walk(ast, {
      enter(node) {
        if (node.type === "Identifier" && types.referenceOf(node)?.type) {
          typed++;
        }
      },
    });
  }
  expect(typed).toBeGreaterThan(500);
});
