import { lexImportsExports, parseImportsExports } from "sveast";
import { lexImportsExports as fromEntry } from "sveast/lexer";
import { comparableLexed, expectedLexed } from "../scripts/lexed";
import { attempt, mulberry32 } from "../scripts/shared";
import {
  inputs,
  mutatedModules,
  TRICKY_AND_SNIPPETS,
} from "./imports-exports-inputs";

function compare(source: string, typescript: boolean) {
  const expected = attempt(() =>
    expectedLexed(
      parseImportsExports(source, { typescript, localExports: false }),
    ),
  );
  return (
    expected && { ours: comparableLexed(lexImportsExports(source)), expected }
  );
}

test("sveast/lexer exports the same function", () => {
  expect(fromEntry).toBe(lexImportsExports);
});

describe("matches parseImportsExports on the corpus", () => {
  for (const { file, modules } of inputs) {
    if (modules.length === 0) continue;
    test(file, () => {
      for (const { text, typescript } of modules) {
        const outcome = compare(text, typescript);
        expect(outcome?.ours).toEqual(outcome?.expected);
      }
    });
  }
});

test("matches parseImportsExports on the tricky inputs and TypeScript snippets", () => {
  let compared = 0;
  for (const [source, typescript] of TRICKY_AND_SNIPPETS) {
    const outcome = compare(source, typescript);
    if (outcome === undefined) continue;
    compared++;
    expect(outcome.ours).toEqual(outcome.expected);
  }
  expect(compared).toBeGreaterThan(30);
});

const FORMS: Record<string, string> = {
  "string names and escapes": `
    import { "a-b" as c, "\\u{1F600}" as d, e\\u0066 } from "\\x41\\u0042\\
C";
    export { "f" as "g", h as "i" } from 'j\\'k';
    export * as "l" from "m";`,
  "type modifiers": `
    import type T from "t";
    import type * as W from "w";
    import { type as as, type x, type "y" as z, type as t } from "x";
    export type * as N from "n";
    export { type a, type as as } from "a";`,
  "type as a default import":
    'import type from "u"; import { type as v } from "v";',
  "type as a default import before braces": 'import type, { v } from "v";',
  "comments everywhere": `
    import /* a */ b /* , */ , /* { */ { /* } */ c /* as */ as /* d */ e } /* from */ from /* "f" */ "f" /* ; */ ;
    export /* type */ * /* as */ as /* g */ g /* from */ from "g" // ;
    ;`,
  "attributes and no semicolons": `
    import a from "a" with { type: "json", "b": 'c' }
    export * from "d" with {}
    import e from "e"`,
  "import equals": `
    import f = require("f");
    import type G = require("g");
    import H = I.J.K
    import n = require /* c */ (
      "n")
    export import L = M;`,
};

describe("matches parseImportsExports on each form", () => {
  for (const [name, source] of Object.entries(FORMS)) {
    test(name, () => {
      const outcome = compare(source, true);
      expect(outcome).toBeDefined();
      expect(outcome?.ours).toEqual(outcome?.expected);
    });
  }
});

test("matches parseImportsExports on mutated modules, and never throws", () => {
  let compared = 0;
  const failures: string[] = [];
  for (const { text, typescript } of mutatedModules(6000)) {
    let lexed: ReturnType<typeof lexImportsExports>;
    try {
      lexed = lexImportsExports(text);
    } catch (error) {
      failures.push(`${error}: ${text}`);
      continue;
    }
    const outcome = compare(text, typescript);
    if (outcome === undefined) continue;
    compared++;
    if (
      JSON.stringify(comparableLexed(lexed)) !==
      JSON.stringify(outcome.expected)
    ) {
      failures.push(text);
    }
  }
  expect(failures).toEqual([]);
  expect(compared).toBeGreaterThan(1000);
});

function* generatedModules(count: number): Generator<string> {
  const next = mulberry32(11);
  const random = (n: number) => next() % n;
  const pick = (items: string[]) => items[random(items.length)];
  const trivia = () =>
    pick(["", " ", " ", "\n", "/* c */", "// c\n", "\t", "\r\n"]);
  const space = () => pick([" ", " ", "\n", " /* c */ ", "\t", "// c\n"]);
  let id = 0;
  const name = () =>
    pick([
      "a",
      "type",
      "as",
      "from",
      "café",
      "\\u0061b",
      "$x",
      "of",
      "with",
      "assert",
      "default",
      "x\\u{62}",
      "𝑥",
    ]) + (random(3) ? String(id++) : "");
  const string = () =>
    pick([
      '"a"',
      "'b'",
      '"a\\u0041"',
      "'\\x41'",
      '"a-b"',
      '"\\u{1F600}"',
      '"x\\\ny"',
      '""',
      '"\\0"',
      '"\\8"',
      '"\u2028"',
    ]);
  const exportName = () => (random(4) ? name() : string());
  const list = (isImport: boolean) => {
    const items: string[] = [];
    for (let n = random(4); n > 0; n--) {
      const imported = isImport && random(5) ? name() : exportName();
      let item = (random(4) ? "" : `type${space()}`) + imported;
      if (random(2) || (isImport && imported.startsWith('"'))) {
        item += `${space()}as${space()}${isImport ? name() : exportName()}`;
      }
      items.push(item);
    }
    return `{${trivia()}${items.join(`${trivia()},${trivia()}`)}${random(4) ? "" : ","}${trivia()}}`;
  };
  const end = () =>
    (random(4)
      ? ""
      : `${trivia()}${pick(["with", "assert"])}${trivia()}${pick(['{ type: "json" }', "{}", "{ 'a': \"b\", c: 'd' }"])}`) +
    (random(3) ? `${trivia()};` : "");
  const from = () => `${trivia()}from${trivia()}${string()}${end()}`;
  const importEquals = () =>
    `${space()}${random(2) ? `type${space()}` : ""}${name()}${trivia()}=${trivia()}${random(2) ? `require${trivia()}(${trivia()}${string()}${trivia()})` : `${name()}.${name()}`}${random(3) ? ";" : ""}`;
  const statement = () => {
    if (random(4) === 0) {
      return pick([
        "const q = 1;",
        "let z = a / b / c;",
        "f(`t`) / 2;",
        "/re/g.test(s);",
        "export let p;",
        "export default 1;",
        "import.meta.url;",
        "import('x');",
      ]);
    }
    if (random(3) === 0) {
      if (random(12) === 0) return `export${space()}import${importEquals()}`;
      const type = random(4) ? "" : `${space()}type`;
      return `export${type}${random(2) ? `${trivia()}*${random(2) ? `${trivia()}as${space()}${exportName()}` : ""}` : trivia() + list(false)}${from()}`;
    }
    if (random(8) === 0) return `import${trivia()}${string()}${end()}`;
    if (random(12) === 0) return `import${importEquals()}`;
    const type = random(4) ? "" : `${space()}type`;
    const clause = [
      () => space() + name(),
      () =>
        `${space()}${name()}${trivia()},${trivia()}*${trivia()}as${space()}${name()}`,
      () => `${space()}${name()}${trivia()},${trivia()}${list(true)}`,
      () => `${trivia()}*${trivia()}as${space()}${name()}`,
      () => trivia() + list(true),
    ][random(5)]();
    return `import${type}${clause}${from()}`;
  };
  const edits = [
    "{",
    "}",
    ",",
    ";",
    "*",
    "as",
    "from",
    "type",
    '"s"',
    "'",
    '"',
    "\\",
    "/*",
    "*/",
    "//",
    "\n",
    "=",
    "(",
    ")",
    "with",
    " ",
  ];
  for (let i = 0; i < count; i++) {
    const statements: string[] = [];
    for (let n = 1 + random(4); n > 0; n--) statements.push(statement());
    let text = statements.join(pick(["\n", " ", ";", "\n\n"]));
    if (random(3) === 0) {
      const at = random(text.length + 1);
      text = text.slice(0, at) + pick(edits) + text.slice(at + random(3));
    }
    yield text;
  }
}

test("matches parseImportsExports on generated modules, and never throws", () => {
  let compared = 0;
  const failures: string[] = [];
  for (const text of generatedModules(20000)) {
    let lexed: ReturnType<typeof comparableLexed>;
    try {
      lexed = comparableLexed(lexImportsExports(text));
    } catch (error) {
      failures.push(`${error}: ${text}`);
      continue;
    }
    for (const typescript of [false, true]) {
      const outcome = compare(text, typescript);
      if (outcome === undefined) continue;
      compared++;
      if (JSON.stringify(lexed) !== JSON.stringify(outcome.expected)) {
        failures.push(text);
      }
    }
  }
  expect(failures).toEqual([]);
  expect(compared).toBeGreaterThan(10000);
});

test("returns what an import needs", () => {
  expect(
    lexImportsExports(
      'let a = 1;\nimport B, { type C, D as E } from "f";\nexport * from "g";',
    ),
  ).toEqual([
    {
      kind: "import",
      start: 11,
      end: 49,
      source: { value: "f", start: 45, end: 48 },
      typeOnly: false,
      specifiers: [
        {
          kind: "default",
          imported: "default",
          local: "B",
          typeOnly: false,
          start: 18,
          end: 19,
        },
        {
          kind: "named",
          imported: "C",
          local: "C",
          typeOnly: true,
          start: 23,
          end: 29,
        },
        {
          kind: "named",
          imported: "D",
          local: "E",
          typeOnly: false,
          start: 31,
          end: 37,
        },
      ],
    },
    {
      kind: "export",
      start: 50,
      end: 68,
      source: { value: "g", start: 64, end: 67 },
      typeOnly: false,
      specifiers: [
        {
          kind: "all",
          local: "*",
          exported: null,
          typeOnly: false,
          start: 57,
          end: 58,
        },
      ],
    },
  ]);
});

test("gives export * as its offsets", () => {
  const [statement] = lexImportsExports('export * as /* a */ ns from "a";');
  expect(statement.specifiers[0]).toMatchObject({ start: 7, end: 22 });
});

test("returns a statement it can't read without a source", () => {
  for (const [source, end] of [
    ['import { a from "a";', 10],
    ['import a from b; import c from "c";', 13],
    ['import a from "a', 13],
    ['import * from "a";', 8],
    ['import { "a" } from "a";', 12],
    ['import a from "\\8";', 13],
    ["import", 6],
  ] as const) {
    const [statement] = lexImportsExports(source);
    expect(statement).toEqual({
      kind: "import",
      start: 0,
      end,
      source: null,
      typeOnly: false,
      specifiers: [],
    });
  }
});

test("finds the statements after one it can't read", () => {
  expect(
    lexImportsExports('import { a, from "a";\nimport b from "b";').map(
      (statement) => statement.source?.value ?? null,
    ),
  ).toEqual([null, "b"]);
});

test("skips local exports, dynamic imports and import.meta", () => {
  expect(
    lexImportsExports(
      'export let a; export { b }; export default c; import("d"); import.meta; export function e() {}',
    ),
  ).toEqual([]);
});
