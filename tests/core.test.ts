import {
  ParseError,
  parse,
  parseImportsExports,
  parseModule,
} from "svelte-ast";
import { ParseError as CoreParseError, createParser } from "svelte-ast/core";
import { entities } from "svelte-ast/entities";
import {
  createModuleParser,
  ParseError as ModuleParseError,
} from "svelte-ast/module";
import { typescript } from "svelte-ast/typescript";
import { MODULE_FILES } from "../scripts/lexed";
import { byCodeUnit } from "../scripts/shared";
import { corpusFiles, readCorpus } from "./shared";

const files = corpusFiles(MODULE_FILES);

const LANG_TS = /<script[^>]*\blang=["']?ts\b/;
const NAMED_REFERENCE = /&(?!(?:amp|apos|gt|lt|quot)\b)[A-Za-z]/;

function outcome(run: () => object) {
  try {
    return { ast: run() };
  } catch (error) {
    return error instanceof ParseError
      ? { code: error.code, position: error.position }
      : { error: `${error}` };
  }
}

function matchesFullParser(
  parser: ReturnType<typeof createParser>,
  file: string,
): boolean {
  const source = readCorpus(file);
  if (file.endsWith(".svelte")) {
    return Bun.deepEquals(
      outcome(() => parser.parse(source, { loc: true })),
      outcome(() => parse(source, { loc: true })),
    );
  }
  const options = { typescript: file.endsWith(".ts") };
  return Bun.deepEquals(
    outcome(() => parser.parseModule(source, options)),
    outcome(() => parseModule(source, options)),
  );
}

test("svelte-ast/core, svelte-ast/module, svelte-ast/typescript and svelte-ast/entities export only their parts", async () => {
  expect(Object.keys(await import("svelte-ast/core")).sort(byCodeUnit)).toEqual(
    ["ParseError", "createParser"],
  );
  expect(
    Object.keys(await import("svelte-ast/module")).sort(byCodeUnit),
  ).toEqual(["ParseError", "createModuleParser"]);
  expect(Object.keys(await import("svelte-ast/typescript"))).toEqual([
    "typescript",
  ]);
  expect(Object.keys(await import("svelte-ast/entities"))).toEqual([
    "entities",
  ]);
  expect(CoreParseError).toBe(ParseError);
  expect(ModuleParseError).toBe(ParseError);
});

test("createParser with typescript and entities parses like svelte-ast", () => {
  const parser = createParser({ typescript, entities });
  expect(files.filter((file) => !matchesFullParser(parser, file))).toEqual([]);
  expect(files.length).toBeGreaterThan(700);
});

test("createParser without either parses JavaScript components like svelte-ast unless they use named references", () => {
  const parser = createParser();
  const compared = files.filter((file) => {
    if (!file.endsWith(".svelte")) return false;
    const source = readCorpus(file);
    return !LANG_TS.test(source) && !NAMED_REFERENCE.test(source);
  });
  expect(compared.filter((file) => !matchesFullParser(parser, file))).toEqual(
    [],
  );
  expect(compared.length).toBeGreaterThan(300);
});

test("without typescript, TypeScript throws an Error, not a ParseError", () => {
  const { parse: parseJs, parseModule: parseModuleJs } = createParser();
  const source = '<script lang="ts">let a: number = 1;</script>{a}';
  for (const run of [
    () => parseJs(source),
    () => parseJs(source, { script: false }),
    () => parseModuleJs("let a: number;", { typescript: true }),
  ]) {
    expect(run).toThrow(
      'svelte-ast: parsing TypeScript needs `typescript` from "svelte-ast/typescript"',
    );
    expect(run).not.toThrow(ParseError);
  }
  expect(parseModuleJs("let a = 1;").body).toHaveLength(1);
  expect(createParser({ typescript }).parse(source).instance).toEqual(
    parse(source).instance,
  );
});

test("createModuleParser with typescript parses modules like svelte-ast", () => {
  const { parseModule: parseModuleOnly, parseImportsExports: importsOnly } =
    createModuleParser({ typescript });
  const modules = files.filter((file) => !file.endsWith(".svelte"));
  const differ = modules.filter((file) => {
    const source = readCorpus(file);
    const options = { typescript: file.endsWith(".ts") };
    return (
      !Bun.deepEquals(
        outcome(() => parseModuleOnly(source, options)),
        outcome(() => parseModule(source, options)),
      ) ||
      !Bun.deepEquals(
        outcome(() => importsOnly(source, options)),
        outcome(() => parseImportsExports(source, options)),
      )
    );
  });
  expect(differ).toEqual([]);
  expect(modules.length).toBeGreaterThan(300);
});

test("createModuleParser without typescript throws an Error on TypeScript, not a ParseError", () => {
  const { parseModule: parseModuleJs, parseImportsExports: importsJs } =
    createModuleParser();
  for (const run of [
    () => parseModuleJs("let a: number;", { typescript: true }),
    () => importsJs('import type A from "a";', { typescript: true }),
  ]) {
    expect(run).toThrow("createModuleParser({ typescript })");
    expect(run).not.toThrow(ParseError);
  }
  expect(parseModuleJs("let a = 1;").body).toHaveLength(1);
  expect(importsJs('import a from "a"; let b;')).toEqual(
    parseImportsExports('import a from "a"; let b;'),
  );
  expect(() => parseModuleJs("let a = ;")).toThrow(ParseError);
});

test("without entities, only numeric and XML references are decoded", () => {
  const source =
    '<p title="&amp;&copy;&#169;&ampx">&lt;&gt;&quot;&apos;&copy;&nbsp;&#x41;&ltx &notin;</p>';
  const text = (ast: ReturnType<typeof parse>) => {
    const p = ast.fragment.nodes[0];
    if (p.type !== "RegularElement") throw new Error("expected <p>");
    const [title] = p.attributes;
    const [data] = p.fragment.nodes;
    if (
      title.type !== "Attribute" ||
      !Array.isArray(title.value) ||
      title.value[0].type !== "Text" ||
      data.type !== "Text"
    ) {
      throw new Error("expected text");
    }
    return [title.value[0].data, data.data];
  };
  expect(text(createParser().parse(source))).toEqual([
    "&&copy;©&ampx",
    "<>\"'&copy;&nbsp;A<x &notin;",
  ]);
  expect(text(createParser({ entities }).parse(source))).toEqual(
    text(parse(source)),
  );
  expect(text(parse(source))).toEqual(["&©©&ampx", "<>\"'© A<x ∉"]);
});
