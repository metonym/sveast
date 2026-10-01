import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tsPlugin as acornTypeScript } from "@sveltejs/acorn-typescript";
import { Parser } from "acorn";
import { tsPlugin } from "../src/ts-plugin";

const Ours = Parser.extend(tsPlugin);
// biome-ignore lint/suspicious/noExplicitAny: acorn-typescript's plugin type doesn't line up with acorn's extend()
const Theirs = Parser.extend(acornTypeScript() as any);

const OPTIONS = { sourceType: "module", ecmaVersion: 16 } as const;

function parse(
  ParserClass: typeof Parser,
  source: string,
  locations: boolean,
  keepLoc: boolean,
) {
  const comments: unknown[] = [];
  const ast = ParserClass.parse(source, {
    ...OPTIONS,
    locations,
    onComment: comments as never,
  });
  return JSON.stringify({ ast, comments }, (key, value) =>
    key === "loc" && !keepLoc
      ? undefined
      : typeof value === "bigint"
        ? `${value}n`
        : value,
  );
}

const SNIPPETS: Record<string, string> = {
  "variable annotations":
    "let a: string = 1; let b!: number; var c: Foo<Bar>[] | null;",
  "destructured annotations":
    "let { a, b }: Props = $props(); const [c]: [number] = d;",
  "function signatures":
    "function f<T extends X = Y>(a?: T, b: U = 1, ...c: V[]): R {} function g(this: W) {}",
  "type predicates":
    "function f(x): x is string {} function g(x): asserts x {} function h(x): asserts x is T {}",
  overloads:
    "function f(a: string): void; function f(a: number): void; function f(a) {}",
  "arrow functions":
    "const f = (a: T, { b }: U = {}, ...c: D[]): R => a; const g = async (a?: T): Promise<void> => {};",
  "generic arrows":
    "const f = <T,>(a: T) => a; const g = async <T>(a: T): Promise<T> => a; const h = <const T>(x: T) => x;",
  "arrow vs conditional":
    "a ? (b) : c; x = y ? (z): w => 1 : v; f((a?: T) => a);",
  "type assertions":
    "(<T>x).y; x as const; y satisfies Z; z as unknown as T; w!.v!;",
  "call type arguments":
    "f<T>(x); new C<T>(); a?.b<T>(); o?.<T>(x); tag<T>`s`; const g = f<string>;",
  "comparisons that look like type arguments":
    "a < b > c; a < b >> c; if (a < b && c > d) {} x = a<b>\nc;",
  interfaces:
    "interface A<T> extends B<T>, C.D { a?: string; readonly b: number; [k: string]: any; m?<U>(x: U): void; (x): y; new (): Z; get g(): T; set s(v: T); new: boolean }",
  "type aliases":
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a template literal type, not a mistaken placeholder
    'type A = { a: 1 } | "b" | `x${Y}` | [a: string, b?: number, ...c: D[]] | (() => void) | keyof T | T[K] | typeof import("x").Y;',
  "mapped and conditional types":
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a template literal type, not a mistaken placeholder
    "type M = { readonly [K in keyof T as `get${K}`]-?: T[K] }; type C<T> = T extends infer U extends string ? U : never;",
  "type operators":
    "let a: unique symbol; let b: readonly string[]; let c: abstract new () => T; let d: -1 | 1n | true | null | undefined | this;",
  "import and export forms":
    'import type { A } from "a"; import { type B, C } from "b"; import D, { type E as F } from "c"; import type * as NS from "ns"; export type { A }; export { type B, C }; export type * from "m"; export * as N from "n";',
  "exported declarations":
    "export type J = string; export interface K {} export declare const dd: number; export enum EE { A = 1, B } export abstract class AC {} export default interface Q {}",
  declarations:
    'enum E { A = 1, "b" } const enum F {} declare function f(): void; declare module "m" { export const y: number } namespace N.M { const z = 1 } declare global { interface W {} }',
  "import equals and export assignment":
    'import S = require("s"); import R = N.M; export = S;',
  classes:
    "abstract class A<T> extends B<T> implements C, D<E> { private readonly x?: number = 1; static y!: string; declare z: T; protected abstract m(): void; constructor(public a: string, private readonly b = 2) { super() } get g(): number { return 1 } [k: string]: any; override o() {} f(): void; f(a?) {} accessor q = 1; static { init() } }",
  "object literal methods":
    "o = { m<T>(a: T): T { return a }, get x(): number { return 1 }, set x(v: number) {} };",
  "dynamic import":
    'const m = await import("./m", { with: { type: "json" } });',
  decorators:
    "@a.b.c @d<T>() export class X { @e() m() {} @f x = 1; @(g()) static accessor y = 2; constructor(@h() private z: number, @i w) {} } const Y = @j class {};",
  "comments inside speculative parses":
    "f</* a */ T /* b */>(x); a /* c */ < b; const g = (/* d */ a: T /* e */): R /* f */ => a;",
};

describe("ts-plugin matches @sveltejs/acorn-typescript", () => {
  for (const [name, source] of Object.entries(SNIPPETS)) {
    test(name, () => {
      expect(parse(Ours, source, true, true)).toBe(
        parse(Theirs, source, true, true),
      );
      expect(parse(Ours, source, false, false)).toBe(
        parse(Theirs, source, true, false),
      );
    });
  }
});

describe("ts-plugin", () => {
  test("emits `loc` only with `locations`", () => {
    const ast = Ours.parse("let a: T = f<U>(x);", OPTIONS);
    expect(JSON.stringify(ast)).not.toContain('"loc"');
  });

  test.each([
    "let a = 1; let a = 2;",
    'import type { T } from "x"; const T = 1;',
    "class A {} class A {}",
    "type T = 1; type T = 2;",
    "const x = 1; function x() {}",
    "const enum E {} const E = 1;",
    "export { x }",
    "function f(a: string): void; function f(a) {}",
    "interface A {} class A {}",
    "enum E { A } enum E { B } namespace E {}",
    "namespace N { const x = 1 } const x = 2;",
    "declare function f(): void; function f() {}",
    "type T = 1; export { T }",
    "const f = <>(x) => x;",
  ])("declarations: %s", (source) => {
    const outcome = (ParserClass: typeof Parser) => {
      try {
        ParserClass.parse(source, { ...OPTIONS, locations: true });
        return "ok";
      } catch (error) {
        return (error as Error).message;
      }
    };
    expect(outcome(Ours)).toBe(outcome(Theirs));
  });

  test("rejects invalid types", () => {
    for (const text of ['"a" |', "{ a: }", "Array<", "(a: ) => void"]) {
      expect(() => Ours.parse(`type T = ${text}\n;`, OPTIONS)).toThrow(
        SyntaxError,
      );
    }
  });
});

const CARBON = join(import.meta.dir, "corpus/carbon");
const MODULES = readdirSync(CARBON, { recursive: true, encoding: "utf8" })
  .filter((path) => path.endsWith(".js") || path.endsWith(".ts"))
  .sort();

describe("ts-plugin matches acorn-typescript on Carbon's modules", () => {
  test.each(MODULES)("%s", (path) => {
    const source = readFileSync(join(CARBON, path), "utf8");
    const outcome = (ParserClass: typeof Parser) => {
      try {
        return parse(ParserClass, source, true, true);
      } catch (error) {
        return (error as Error).message;
      }
    };
    expect(outcome(Ours)).toBe(outcome(Theirs));
  });
});
