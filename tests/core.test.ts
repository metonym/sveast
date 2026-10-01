import { readFileSync } from "node:fs";
import path from "node:path";
import { Glob } from "bun";
import { ParseError, parse, parseModule } from "sveast";
import { ParseError as CoreParseError, createParser } from "sveast/core";
import { entities } from "sveast/entities";
import { typescript } from "sveast/typescript";
import { byCodeUnit } from "../scripts/shared";

const root = path.join(import.meta.dir, "corpus");
const files: string[] = [];
for await (const file of new Glob("**/*.{svelte,js,ts}").scan(root)) {
  files.push(file);
}
files.sort(byCodeUnit);

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

function sameAsSveast(
  parser: ReturnType<typeof createParser>,
  file: string,
): boolean {
  const source = readFileSync(path.join(root, file), "utf8");
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

test("sveast/core, sveast/typescript and sveast/entities export only their parts", async () => {
  expect(Object.keys(await import("sveast/core")).sort(byCodeUnit)).toEqual([
    "ParseError",
    "createParser",
  ]);
  expect(Object.keys(await import("sveast/typescript"))).toEqual([
    "typescript",
  ]);
  expect(Object.keys(await import("sveast/entities"))).toEqual(["entities"]);
  expect(CoreParseError).toBe(ParseError);
});

test("createParser with typescript and entities parses like sveast", () => {
  const parser = createParser({ typescript, entities });
  expect(files.filter((file) => !sameAsSveast(parser, file))).toEqual([]);
  expect(files.length).toBeGreaterThan(700);
});

test("createParser without either parses JavaScript components like sveast unless they use named references", () => {
  const parser = createParser();
  const compared = files.filter((file) => {
    if (!file.endsWith(".svelte")) return false;
    const source = readFileSync(path.join(root, file), "utf8");
    return !LANG_TS.test(source) && !NAMED_REFERENCE.test(source);
  });
  expect(compared.filter((file) => !sameAsSveast(parser, file))).toEqual([]);
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
    expect(run).toThrow('needs `typescript` from "sveast/typescript"');
    expect(run).not.toThrow(ParseError);
  }
  expect(parseModuleJs("let a = 1;").body).toHaveLength(1);
  expect(createParser({ typescript }).parse(source).instance).toEqual(
    parse(source).instance,
  );
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
