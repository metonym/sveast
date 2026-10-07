import { join } from "node:path";
import { MODULE_FILES, type Module, modulesIn } from "../scripts/lexed";
import { CORPUS, corpusFiles, mutated } from "./shared";
import { SNIPPETS } from "./ts-snippets";

export const inputs = corpusFiles(MODULE_FILES).map((file) => ({
  file,
  modules: modulesIn(join(CORPUS, file)),
}));

export const TRICKY: Record<string, string> = {
  "keywords in strings and comments": `
    const a = "import x from 'y'"; // import z from "w"
    /* export const b = 1; */ const c = 'export {}';
    import d from "d";`,
  "keywords as properties": `
    a.import(); b?.export; c.export = 1; d . import;
    const o = { import: 1, export: 2 };
    export { o };`,
  "dynamic import and import.meta": `
    import("a").then(() => {}); const u = import.meta.url;
    await import /* c */ ("b");
    import e from "e";`,
  "regular expressions with brackets and quotes": `
    const r = /[}'"\`]/g.test(x) ? /\\/{/ : /"/;
    if (r) /}/.exec(y);
    const s = x.replace(/\`/g, "") / 2 / 3;
    export { r };`,
  "division after values": `
    const a = b / c / d, e = f() / 2 / g, h = i[0] / j / k, l = 1 / 2 / 3;
    const m = \`\${a}\` / 2 / n;
    export { a };`,
  "templates with nested expressions": `
    const t = \`a \${\`b \${{ c: "}" }.c} \\\`\`} d \${/}/.source}\`;
    export const u = \`\${t}\`;`,
  "statements after blocks and objects": `
    function f() { return { a: {} }; }
    /export/.test(f);
    const o = { a: 1 } / 2;
    class A { x = /}/; static { this.y = "{"; } }
    export default A;`,
  "nested export in object types and blocks": `
    { const export_ = 1; }
    function g() { const s = \`export \${1}\`; }
    export function h() { return /export/; }
    export class B extends A { import() {} }`,
  "exports that look like re-exports": `
    export { a /* } from "x" */, b as "}" };
    export { c };
    from("d");
    export default { from: "e" };
    export const f = { g } /* from */;`,
  "export forms": `
    export const a = 1, b = 2;
    export let c;
    export function* d() {}
    export async function e() {}
    export class F {}
    export { a as "string name", b as bb };
    export * from "g";
    export * as h from "h";
    export { i } from "i" with { type: "json" };
    export default function () {}`,
  "import forms": `
    import "side-effect";
    import a, { b, c as d, "e" as e } from "f";
    import * as g from "g";
    import h, * as i from "h";
    import j from "j" with { type: "json" };`,
  "unicode and escapes": `
    const café = 1; const \\u0061 = 2; export { café };
    export const k = 3;`,
  "line continuations":
    "const a = \"b\\\r\n{\", c = 'd\\\n{';\r\nexport { a };",
  hashbang: `#!/usr/bin/env node
    import a from "a";`,
};

export const TRICKY_TS: Record<string, string> = {
  "type-only imports and exports": `
    import type { A } from "a";
    import { type B, C } from "b";
    export type { D } from "d";
    export type E = { f: "}" };
    export interface G { h: \`\${string}\`; }
    export declare const i: number;
    export enum J { K }
    export abstract class L {}`,
  "import equals and export assignment": `
    import m = require("m");
    import N = O.P;
    export import Q = R.S;
    export import t = require("t");
    export = m;`,
  "type-only re-exports": `
    export type * from "a";
    export type * as b from "b";
    export type { c } from "c";
    export type { d };
    export type E = { from: "e" };`,
  "namespace export": "export as namespace UMD;",
  "nested modules": `
    declare module "x" { import y from "y"; export { y }; }
    namespace Z { export const z = 1; }
    declare global { interface W {} }
    export { Z };`,
  "non-null before division": `
    const a = b! / c / d;
    const e = f!/g/h;
    export { a };`,
  "generics and type imports": `
    let x: typeof import("x") = f<{ a: 1 }>(1) / 2;
    type T = import("t").U<{ v: "{" }>;
    export type { T };`,
  decorators: `
    @dec export class A {}
    @a.b(c) @d
    export default class B {}
    export @e class C {}
    @f class D {}
    export { D };`,
};

const EDITS = [
  ..."/{}`'\"\\*$()@\n!.#;<>[]",
  "${",
  "\r\n",
  "export ",
  "import ",
  "/*",
  "*/",
  "//",
  "?.",
  "=>",
  "from ",
  "type ",
  "\u2028",
];

export const TRICKY_AND_SNIPPETS: [text: string, typescript: boolean][] = [
  ...Object.values(TRICKY).map((text): [string, boolean] => [text, false]),
  ...[...Object.values(TRICKY_TS), ...Object.values(SNIPPETS)].map(
    (text): [string, boolean] => [text, true],
  ),
];

export function* mutatedModules(count: number): Generator<Module> {
  const corpus = inputs.flatMap((input) =>
    input.file.endsWith(".svelte") ? [] : input.modules,
  );
  const texts = corpus.map((module) => module.text);
  for (const [text, index] of mutated(texts, EDITS, count)) {
    yield { text, typescript: corpus[index].typescript };
  }
}
