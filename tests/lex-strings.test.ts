import { type LexedString, lexStrings, parseModule } from "sveast";
import { lexStrings as fromEntry } from "sveast/lexer";
import { expectedStrings } from "../scripts/lexed";
import {
  inputs,
  mutatedModules,
  TRICKY,
  TRICKY_TS,
} from "./imports-exports-inputs";
import { SNIPPETS } from "./ts-snippets";

/** The strings `parseModule` implies, or `undefined` if it throws. */
function expected(
  source: string,
  typescript: boolean,
): LexedString[] | undefined {
  try {
    return expectedStrings(parseModule(source, { typescript }));
  } catch {
    return;
  }
}

test("sveast/lexer exports the same function", () => {
  expect(fromEntry).toBe(lexStrings);
});

describe("matches parseModule on the corpus", () => {
  for (const { file, modules } of inputs) {
    if (modules.length === 0) continue;
    test(file, () => {
      for (const { text, typescript } of modules) {
        const strings = expected(text, typescript);
        expect(strings && lexStrings(text)).toEqual(strings);
      }
    });
  }
});

test("matches parseModule on the tricky inputs and TypeScript snippets", () => {
  const cases: [string, boolean][] = [
    ...Object.values(TRICKY).map((source): [string, boolean] => [
      source,
      false,
    ]),
    ...Object.values(TRICKY_TS).map((source): [string, boolean] => [
      source,
      true,
    ]),
    ...Object.values(SNIPPETS).map((source): [string, boolean] => [
      source,
      true,
    ]),
  ];
  let compared = 0;
  for (const [source, typescript] of cases) {
    const strings = expected(source, typescript);
    if (strings === undefined) continue;
    compared++;
    expect(lexStrings(source)).toEqual(strings);
  }
  expect(compared).toBeGreaterThan(30);
});

const FORMS: Record<string, [string, boolean]> = {
  escapes: [
    String.raw`a = ["\n\r\t\b\v\f\0", "\x41B\u{1F600}", '\'"\\', "a\
b", " ", "é"];`,
    false,
  ],
  "templates with escapes and line breaks": [
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a template literal in the lexed source
    "a = `\\u0041${b}\\`\r\nc\rd\\\r\ne`; f = String.raw`\\unicode ${g} \\x`;",
    false,
  ],
  "nested templates and objects in expressions": [
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a template literal in the lexed source
    'a = `b${`c${{ d: "}" }.d}`}e${f({ "g": `h` })}`;',
    false,
  ],
  "regular expressions with quotes": [
    `a = /"/.test(b) ? /'/ : /\`/; if (c) /"/.exec(d); while (e) /'/;
    f = g / "h" / i; j = k() / 'l' / m[0] / "n";
    function o() {} /"/.test(p); q = { r: /"/ } / 2;`,
    false,
  ],
  "comments with quotes": [
    `// "a"\n/* 'b' \`c\` */ d = "e" // 'f'\n/** "g" */`,
    false,
  ],
  "keywords before a regular expression": [
    `function* a() { return /"/; yield /'/; } typeof /"/; void /'/;
    b = c in /"/ ? d instanceof /'/ : e; switch (f) { case /"/: }
    throw /'/;`,
    false,
  ],
  "a hashbang": ['#!/usr/bin/env node "a"\nb = "c";', false],
  "imports, exports and directives": [
    `"use strict"; import a, { "b-c" as d } from "e" with { type: "json" };
    export { a as "f" }; export * from 'g';`,
    false,
  ],
  "TypeScript types": [
    `type A<T> = T extends "a" ? \`b\${T}c\` : 'd';
    enum E { F = "f", "g" = 1 }
    declare module "h" { export const i: "j"; }
    import k = require("l");
    let m = <T,>(n: T): "o" => "o" as const;
    const p = q<R>("s") / 2 / t!;
    const u = v! / "w" / x;
    function y(this: Z, a?: "b"): asserts a is "c" {}
    class D<E extends "f"> { g: "h" = "h"; #i = 'j'; }`,
    true,
  ],
  "generics before regular expressions": [
    `const a = <T>(b: T) => /"/.test(\`\${b}\`);
    const c: Array<"d"> = []; /'/.test("e");
    f<G>(/"/); h = i < j > /'/.source;`,
    true,
  ],
};

describe("matches parseModule on each form", () => {
  for (const [name, [source, typescript]] of Object.entries(FORMS)) {
    test(name, () => {
      const strings = expected(source, typescript);
      expect(strings).toBeDefined();
      expect(lexStrings(source)).toEqual(strings as LexedString[]);
    });
  }
});

test("matches parseModule on mutated modules, and never throws", () => {
  let compared = 0;
  const failures: string[] = [];
  for (const { text, typescript } of mutatedModules(6000)) {
    let lexed: LexedString[];
    try {
      lexed = lexStrings(text);
    } catch (error) {
      failures.push(`${error}: ${text}`);
      continue;
    }
    const strings = expected(text, typescript);
    if (strings === undefined) continue;
    compared++;
    if (JSON.stringify(lexed) !== JSON.stringify(strings)) failures.push(text);
  }
  expect(failures).toEqual([]);
  expect(compared).toBeGreaterThan(1000);
});

test("gives a null value for escapes acorn rejects", () => {
  expect(lexStrings('a = "\\1"; b = "\\u{110000}"; c`\\x`;')).toEqual([
    { kind: "string", value: null, start: 4, end: 8 },
    { kind: "string", value: null, start: 14, end: 26 },
    { kind: "template", value: null, start: 30, end: 32 },
  ]);
});

test("never throws on unterminated strings, templates and regular expressions", () => {
  for (const source of ['a = "b', "a = 'b\nc'", "a = `b${c", "a = `b", "/a"]) {
    expect(() => lexStrings(source)).not.toThrow();
  }
});
