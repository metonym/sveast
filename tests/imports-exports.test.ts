import {
  type ModuleDeclaration,
  ParseError,
  parseImportsExports,
  parseModule,
} from "sveast";
import { expectedImportsExports } from "../scripts/lexed";
import { attempt, plain } from "../scripts/shared";
import {
  inputs,
  mutatedModules,
  TRICKY,
  TRICKY_TS,
} from "./imports-exports-inputs";
import { SNIPPETS } from "./ts-snippets";

function compare(source: string, typescript: boolean) {
  const body = attempt(
    () => parseModule(source, { typescript, comments: false }).body,
  );
  return (
    body && {
      ours: {
        all: plain(parseImportsExports(source, { typescript })),
        fromOnly: plain(
          parseImportsExports(source, { typescript, localExports: false }),
        ),
      },
      theirs: {
        all: plain(expectedImportsExports(body, true)),
        fromOnly: plain(expectedImportsExports(body, false)),
      },
    }
  );
}

test("the corpus has imports and exports", () => {
  const modules = inputs.flatMap((input) => input.modules);
  const declarations = modules.flatMap(({ text, typescript }) => {
    try {
      return parseImportsExports(text, { typescript });
    } catch {
      return [];
    }
  });
  expect(modules.length).toBeGreaterThan(600);
  expect(declarations.length).toBeGreaterThan(2000);
});

describe("matches parseModule's import and export statements on the corpus", () => {
  for (const { file, modules } of inputs) {
    if (modules.length === 0) continue;
    test(file, () => {
      for (const { text, typescript } of modules) {
        const outcome = compare(text, typescript);
        expect(outcome?.ours).toEqual(outcome?.theirs);
      }
    });
  }
});

test("matches parseModule on the TypeScript snippets", () => {
  for (const snippet of Object.values(SNIPPETS)) {
    const outcome = compare(snippet, true);
    expect(outcome?.ours).toEqual(outcome?.theirs ?? {});
  }
});

describe("matches parseModule", () => {
  for (const [name, source] of Object.entries(TRICKY)) {
    test(name, () => {
      for (const typescript of [false, true]) {
        const outcome = compare(source, typescript);
        expect(outcome?.ours).toEqual(outcome?.theirs ?? {});
      }
    });
  }
  for (const [name, source] of Object.entries(TRICKY_TS)) {
    test(name, () => {
      const outcome = compare(source, true);
      expect(outcome?.ours).toEqual(outcome?.theirs ?? {});
    });
  }
});

test("matches parseModule, or throws a ParseError, on mutated modules", () => {
  let compared = 0;
  const failures: string[] = [];
  for (const { text, typescript } of mutatedModules(6000)) {
    let outcome: ReturnType<typeof compare>;
    try {
      outcome = compare(text, typescript);
    } catch (error) {
      if (!(error instanceof ParseError)) failures.push(`${error}: ${text}`);
      continue;
    }
    if (outcome === undefined) continue;
    compared++;
    if (JSON.stringify(outcome.ours) !== JSON.stringify(outcome.theirs)) {
      failures.push(text);
    }
  }
  expect(failures).toEqual([]);
  expect(compared).toBeGreaterThan(1000);
});

test("returns what an import needs", () => {
  const [node] = parseImportsExports(
    'let a = 1;\nimport { type B, C as D } from "e";',
    { typescript: true },
  );
  expect(node.type).toBe("ImportDeclaration");
  if (node.type !== "ImportDeclaration") return;
  expect([node.start, node.end, node.source.value]).toEqual([11, 46, "e"]);
  expect(
    node.specifiers.map((specifier) =>
      specifier.type === "ImportSpecifier"
        ? [
            specifier.imported.type === "Identifier" && specifier.imported.name,
            specifier.local.name,
            specifier.importKind,
          ]
        : [],
    ),
  ).toEqual([
    ["B", "B", "type"],
    ["C", "D", "value"],
  ]);
});

test("throws parseModule's error for an import or export", () => {
  for (const source of [
    'import { a from "a";',
    "export { a }; export { a };",
    "export default 1; export default 2;",
    'import type { A } from "a";',
  ]) {
    let error: unknown;
    try {
      parseModule(source, { comments: false });
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toBeInstanceOf(ParseError);
    expect(() => parseImportsExports(source)).toThrow(
      (error as ParseError).message,
    );
  }
});

test("throws rather than hangs on a stray slash in a re-export", () => {
  expect(() =>
    parseImportsExports('export { a / b } from "c";', { localExports: false }),
  ).toThrow(ParseError);
});

test("doesn't report errors outside imports and exports", () => {
  const declarations: ModuleDeclaration[] = parseImportsExports(
    'let a = ;\nimport b from "b";\nconst = 1;',
  );
  expect(declarations.map((node) => node.type)).toEqual(["ImportDeclaration"]);
});

test("TypeScript needs the option", () => {
  expect(() => parseImportsExports('import type { A } from "a";')).toThrow(
    ParseError,
  );
});
