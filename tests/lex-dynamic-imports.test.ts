import { type LexedDynamicImport, lexDynamicImports } from "sveast";
import { lexDynamicImports as fromEntry } from "sveast/lexer";
import { expectedDynamicImports } from "../scripts/lexed";
import {
  inputs,
  mutatedModules,
  TRICKY_AND_SNIPPETS,
} from "./imports-exports-inputs";

test("sveast/lexer exports the same function", () => {
  expect(fromEntry).toBe(lexDynamicImports);
});

describe("matches parseModule on the corpus", () => {
  for (const { file, modules } of inputs) {
    if (modules.length === 0) continue;
    test(file, () => {
      for (const { text, typescript } of modules) {
        const imports = expectedDynamicImports(text, typescript);
        expect(imports && lexDynamicImports(text)).toEqual(imports);
      }
    });
  }
});

test("matches parseModule on the tricky inputs and TypeScript snippets", () => {
  let compared = 0;
  for (const [source, typescript] of TRICKY_AND_SNIPPETS) {
    const imports = expectedDynamicImports(source, typescript);
    if (imports === undefined) continue;
    compared++;
    expect(lexDynamicImports(source)).toEqual(imports);
  }
  expect(compared).toBeGreaterThan(30);
});

const FORMS: Record<string, [string, boolean]> = {
  "literal and computed arguments": [
    `import("a"); import('b'); import(\`c\`); require("d");
    import(e); import(\`./\${f}.js\`); import("g" + h); require(i, "j");
    import("k", { with: { type: "json" } }); import(/* c */ "l" /* d */);
    import(\`\\u0041\`); require(); import("m",);`,
    false,
  ],
  "nested calls": [
    `async function a() { await import("b"); return () => require("c"); }
    const d = { e: import("f"), [import("g")]: 1, h: i ? import("j") : require("k") };
    \`\${import("l")}\`; m(import("n"), [require("o")]);
    export default import("p"); export const q = require("r");`,
    false,
  ],
  "comments, strings, templates and regular expressions": [
    `// import("a")
    /* require("b") */ const c = "import('d')", e = \`require("f")\`;
    const g = /import\\("h"\\)/; import i from "j"; export * from "k";`,
    false,
  ],
  "properties and methods": [
    `a.import("b"); c?.require("d"); e.require.resolve("f");
    const g = { import(h) {}, i, require(j) {}, k: 1 };
    class L { import() {} static require() {} m = 1; import(n) {} }
    function require(o) {} require.cache; typeof require;`,
    false,
  ],
  "import.meta.glob": [
    `import.meta.glob("./*.svelte"); import.meta.glob(["./a/*.js", "!./a/b.js"]);
    import.meta.glob(\`./c/*.js\`, { eager: true }); import.meta.url; import.meta.env.glob("d");`,
    false,
  ],
  "TypeScript import types and import equals": [
    `let a: typeof import("a") = b;
    type C = import("c").D<{ e: "f" }>;
    function g(): import("h") { return i; }
    import j = require("j");
    export import k = require("k");
    declare module "l" { import m = require("m"); }
    declare function require(id: string): any;
    class N { import(): void {} require(o: string): P { return q; } }
    const r = { s, import(): void {} };
    t ? import("u") : v;`,
    true,
  ],
  "import.meta.glob with type arguments": [
    `const a = import.meta.glob<{ default: import("svelte").Component; b: () => "c>" }>("./*.svelte", { eager: true });
    const d = import.meta.glob<E>(["./f/*.js"]);`,
    true,
  ],
};

describe("matches parseModule on each form", () => {
  for (const [name, [source, typescript]] of Object.entries(FORMS)) {
    test(name, () => {
      const imports = expectedDynamicImports(source, typescript);
      expect(imports).toBeDefined();
      expect(lexDynamicImports(source)).toEqual(
        imports as LexedDynamicImport[],
      );
    });
  }
});

test("matches parseModule on mutated modules, and never throws", () => {
  let compared = 0;
  const failures: string[] = [];
  for (const { text, typescript } of mutatedModules(6000)) {
    let lexed: LexedDynamicImport[];
    try {
      lexed = lexDynamicImports(text);
    } catch (error) {
      failures.push(`${error}: ${text}`);
      continue;
    }
    const imports = expectedDynamicImports(text, typescript);
    if (imports === undefined) continue;
    compared++;
    if (JSON.stringify(lexed) !== JSON.stringify(imports)) failures.push(text);
  }
  expect(failures).toEqual([]);
  expect(compared).toBeGreaterThan(1000);
});

test("returns what a dynamic import needs", () => {
  expect(
    lexDynamicImports(
      'const a = import("b");\nrequire(c);\nimport.meta.glob(`./*.js`);',
    ),
  ).toEqual([
    {
      kind: "import",
      source: { value: "b", start: 17, end: 20 },
      start: 10,
      end: 21,
    },
    { kind: "require", source: null, start: 23, end: 33 },
    {
      kind: "glob",
      source: { value: "./*.js", start: 52, end: 60 },
      start: 35,
      end: 61,
    },
  ]);
});

test("never throws on unterminated calls", () => {
  for (const [source, end] of [
    ['import("a"', 10],
    ["require(", 8],
    ["import(`a", 9],
    ["import.meta.glob(", 17],
  ] as const) {
    expect(lexDynamicImports(source)).toMatchObject([{ source: null, end }]);
  }
});
