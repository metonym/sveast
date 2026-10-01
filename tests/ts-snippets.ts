export const SNIPPETS: Record<string, string> = {
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
    // template literal types; split so they aren't read as placeholders
    'type A = { a: 1 } | "b" | `x$' +
    '{Y}` | [a: string, b?: number, ...c: D[]] | (() => void) | keyof T | T[K] | typeof import("x").Y;',
  "mapped and conditional types":
    "type M = { readonly [K in keyof T as `get$" +
    "{K}`]-?: T[K] }; type C<T> = T extends infer U extends string ? U : never;",
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
  "import attributes":
    'import j from "./j.json" with { type: "json" }; export { k } from "./k.json" with { type: "json" };',
  "dynamic import":
    'const m = await import("./m", { with: { type: "json" } });',
  decorators:
    "@a.b.c @d<T>() export class X { @e() m() {} @f x = 1; @(g()) static accessor y = 2; constructor(@h() private z: number, @i w) {} } const Y = @j class {};",
  "comments inside speculative parses":
    "f</* a */ T /* b */>(x); a /* c */ < b; const g = (/* d */ a: T /* e */): R /* f */ => a;",
};
