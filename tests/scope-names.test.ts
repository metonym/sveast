import { tsPlugin as acornTypeScript } from "@sveltejs/acorn-typescript";
import { Parser } from "acorn";
import { declarations } from "../src/acorn-bridge";
import { tsPlugin } from "../src/ts-plugin";
import { acornOutcome } from "./shared";

const OPTIONS = { sourceType: "module", ecmaVersion: 16 } as const;

const FILLER = Array.from(
  { length: 40 },
  (_, i) => `let l${i}; var v${i}; function f${i}() {}`,
).join(" ");
const TYPES = Array.from(
  { length: 40 },
  (_, i) =>
    `type T${i} = 1; interface I${i} {} enum E${i} {} declare function d${i}(): void;`,
).join(" ");

const outcome = (ParserClass: typeof Parser, source: string) =>
  acornOutcome(ParserClass, source, OPTIONS);

describe("declarations in large scopes match acorn", () => {
  test.each([
    "let l20;",
    "var l20;",
    "var v20;",
    "let v20;",
    "let f20;",
    "function l20() {}",
    "let fresh; let fresh;",
    "function g() { FILLER var l20; let l20; }",
    "function g() { FILLER let v39; }",
    "{ FILLER let l0; }",
    "{ FILLER var l0; }",
    "try {} catch (e) { FILLER var e; }",
    "try {} catch ([e]) { FILLER var e; }",
    "class A { static { FILLER var l0; let l0; } }",
  ])("%s", (statement) => {
    const source = `${FILLER} ${statement.replace("FILLER", FILLER)}`;
    expect(outcome(Parser.extend(declarations), source)).toBe(
      outcome(Parser, source),
    );
  });
});

describe("TypeScript declarations in large scopes match acorn-typescript", () => {
  const Ours = Parser.extend(declarations, tsPlugin);
  const Theirs = Parser.extend(acornTypeScript());
  test.each([
    "type T20 = 2;",
    "interface I20 {}",
    "type I20 = 1;",
    "enum E20 { A }",
    "const E20 = 1;",
    "function d20() {}",
    "let l20;",
    "export { T20, I20, E20, d20 }",
    "export { missing }",
    "namespace N { TYPES type T20 = 2; type T20 = 3; }",
  ])("%s", (statement) => {
    const source = `${FILLER} ${TYPES} ${statement.replace("TYPES", TYPES)}`;
    expect(outcome(Ours, source)).toBe(outcome(Theirs, source));
  });
});
