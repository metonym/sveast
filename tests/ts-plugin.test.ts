import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tsPlugin as acornTypeScript } from "@sveltejs/acorn-typescript";
import { type Comment, Parser } from "acorn";
import { errorMessage } from "../scripts/shared";
import { tsPlugin } from "../src/ts-plugin";
import { SNIPPETS } from "./ts-snippets";

const Ours = Parser.extend(tsPlugin);
const Theirs = Parser.extend(acornTypeScript());

const OPTIONS = { sourceType: "module", ecmaVersion: 16 } as const;

function parse(
  ParserClass: typeof Parser,
  source: string,
  locations: boolean,
  keepLoc: boolean,
) {
  const comments: Comment[] = [];
  const ast = ParserClass.parse(source, {
    ...OPTIONS,
    locations,
    onComment: comments,
  });
  return JSON.stringify({ ast, comments }, (key, value) => {
    if (key === "loc" && !keepLoc) return;
    return typeof value === "bigint" ? `${value}n` : value;
  });
}

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
        return errorMessage(error);
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
        return errorMessage(error);
      }
    };
    expect(outcome(Ours)).toBe(outcome(Theirs));
  });
});
