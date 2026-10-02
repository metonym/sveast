import { parse } from "sveast";
import { tweaks } from "../src/acorn-bridge";
import {
  extendParser,
  type ParserConstructor,
  type ParserInternals,
  type ParserOptions,
} from "../src/acorn-internals";
import { TypeScriptParser } from "../src/typescript-parser";

const PARSERS: [string, ParserConstructor][] = [
  ["JavaScript", extendParser(tweaks)],
  ["TypeScript", TypeScriptParser],
];

const INPUT =
  // biome-ignore lint/suspicious/noTemplateCurlyInString: a template literal in the parsed source
  "let a = 1;\r\nconst b = <T,>(x: T) => x;\n  {c + `d${e}`}\u2028f";
const POSITIONS = [0, 4, INPUT.indexOf("const"), INPUT.indexOf("c +")];

// what a parse leaves behind: scopes, labels, contexts, private names and type state
const DIRTY = [
  "class A { #x = 1; static { label: for (;;) break label; } }",
  "async function* f<T>(@d a: T): T { yield await a; }",
  // biome-ignore lint/suspicious/noTemplateCurlyInString: a template literal in the parsed source
  "(a, { b = 1 }) => `${(c)}` / /re/g",
  "(a, b",
  "class A { #x; async *m() { label: for (;;) { yield await (",
  "declare namespace N { let x: ",
  "`\\u{",
];

function options(
  locations: boolean,
  startLocation?: ParserOptions["startLocation"],
): ParserOptions {
  return {
    sourceType: "module",
    ecmaVersion: 16,
    locations,
    preserveParens: true,
    onComment() {
      // the comparison leaves out the callback
    },
    ...(startLocation && { startLocation }),
  };
}

/**
 * A parser's own fields, without the comment callback, which differs by
 * identity, and `startLocation`, which `reset` takes as an argument. acorn
 * sets `inTemplateElement` only once it reads a template.
 */
function state(parser: ParserInternals) {
  const { options: parserOptions, ...fields } = parser;
  const { onComment: _, startLocation: __, ...rest } = parserOptions;
  return {
    ...fields,
    inTemplateElement: fields.inTemplateElement ?? false,
    options: rest,
  };
}

describe("reset", () => {
  for (const [name, ParserClass] of PARSERS) {
    for (const locations of [false, true]) {
      for (const startLocation of [undefined, { line: 7, column: 3 }]) {
        test(`${name}, locations: ${locations}, startLocation: ${startLocation !== undefined}: the state of a new parser`, () => {
          for (const pos of POSITIONS) {
            const parser = new ParserClass(options(locations), "", 0);
            for (const dirty of DIRTY) {
              parser.reset?.(dirty, 0, undefined);
              try {
                parser.nextToken();
                parser.parseStatement(null, true, Object.create(null));
              } catch {
                // a parse that throws leaves its state behind too
              }
            }
            parser.reset?.(INPUT, pos, startLocation);
            const fresh = new ParserClass(
              options(locations, startLocation),
              INPUT,
              pos,
            );
            expect(state(parser)).toEqual(state(fresh));
          }
        });
      }
    }
  }
});

describe("reused expression parsers", () => {
  test("parse the same after an expression that throws", () => {
    const source = `<script lang="ts">let a: number = 1;</script>{a satisfies number}{(b) => [c, d]}<p class={\`x\${y}\`}>{z}</p>`;
    const before = parse(source, { loc: true });
    for (const broken of ["{(a, b}", "{a satisfies}", "{class {}"]) {
      expect(() => parse(broken)).toThrow();
      expect(parse(source, { loc: true })).toEqual(before);
    }
  });
});
