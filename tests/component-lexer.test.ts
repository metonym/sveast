import { lexComponent } from "sveast";
import { lexComponent as fromEntry } from "sveast/lexer";
import { expectedSections } from "../scripts/lexed-component";
import { SVELTE_FILES } from "../scripts/shared";
import { corpusFiles, mutated, readCorpus } from "./shared";

const COMPONENTS = corpusFiles(SVELTE_FILES).map((path) => ({
  path,
  source: readCorpus(path),
}));

test("sveast/lexer exports the same function", () => {
  expect(fromEntry).toBe(lexComponent);
});

test("matches parse on the corpus", () => {
  let compared = 0;
  for (const { path, source } of COMPONENTS) {
    const expected = expectedSections(source);
    if (expected === undefined) continue;
    compared++;
    expect([path, lexComponent(source)]).toEqual([path, expected]);
  }
  expect(compared).toBeGreaterThan(300);
});

const EDITS = [
  "<script>",
  "</script>",
  "<script module>",
  '<script lang="ts">',
  "<style>",
  "</style>",
  "<svelte:options runes />",
  "<svelte:head>",
  "</svelte:head>",
  "<div>",
  "</div>",
  "<p>",
  "<li>",
  "<textarea>",
  "</textarea>",
  "<!--",
  "-->",
  "{",
  "}",
  "{#if a}",
  "{:else}",
  "{/if}",
  '{"<script>"}',
  `{\`\${'}'}\`}`,
  "{/x/}",
  '"',
  "'",
  "`",
  "/*",
  "//",
  "\n",
  " ",
  "=",
  ">",
  "/>",
  " lang='ts'",
];

test("matches parse on mutated components, and never throws", () => {
  const sources = COMPONENTS.map((component) => component.source);
  let compared = 0;
  for (const [source] of mutated(sources, EDITS, 4000, 6000)) {
    const lexed = lexComponent(source);
    const expected = expectedSections(source);
    if (expected === undefined) continue;
    compared++;
    expect([source, lexed]).toEqual([source, expected]);
  }
  expect(compared).toBeGreaterThan(1000);
});

describe("finds only top-level sections", () => {
  const cases: Record<string, string> = {
    "in <svelte:head>": "<svelte:head><script>a</script></svelte:head>",
    "in a block": "{#if a}<script>a</script>{/if}",
    "in an element": "<div><style>a {}</style></div>",
    "in an attribute": '<div title="<script>a</script>"></div>',
    "in an expression": '<div>{"<script>a</script>"}</div>',
    "in a template literal": `{\`\${'}'}<script>a</script>\`}`,
    "in a comment": "<!-- <script>a</script> -->",
    "in a <textarea>": "<textarea><script>a</script></textarea>",
    "in an unclosed <p>": "<p>a<script>b</script>",
  };
  for (const [name, source] of Object.entries(cases)) {
    test(name, () => {
      expect(lexComponent(source)).toEqual({
        typescript: false,
        instance: null,
        module: null,
        css: null,
        options: null,
      });
    });
  }

  test("after an element closed by the next one", () => {
    const source = "<p>a<div></div><script>b</script>";
    expect(lexComponent(source).instance?.start).toBe(15);
    expect(expectedSections(source)?.instance?.start).toBe(15);
  });
});

test("reads attributes as written", () => {
  const source =
    '<svelte:options runes={true} namespace="svg" />\n<script lang="ts" module>let a: number;</script>\n<style lang=scss>a { b: "</style>" }</style>';
  expect(lexComponent(source)).toEqual({
    typescript: true,
    instance: null,
    module: {
      start: 48,
      end: 96,
      context: "module",
      attributes: [
        { name: "lang", value: "ts", start: 56, end: 65 },
        { name: "module", value: true, start: 66, end: 72 },
      ],
      content: { start: 73, end: 87 },
    },
    css: {
      start: 97,
      end: 141,
      attributes: [{ name: "lang", value: "scss", start: 104, end: 113 }],
      content: { start: 114, end: 133 },
    },
    options: {
      start: 0,
      end: 47,
      attributes: [
        { name: "runes", value: "{true}", start: 16, end: 28 },
        { name: "namespace", value: "svg", start: 29, end: 44 },
      ],
    },
  });
  expect(lexComponent(source)).toEqual(expectedSections(source));
});

test("is TypeScript as svelte decides it, from the first script with a lang", () => {
  expect(lexComponent('<script lang="ts"></script>').typescript).toBe(true);
  expect(
    lexComponent(
      '<script lang="js"></script><script lang="ts" module></script>',
    ).typescript,
  ).toBe(false);
  expect(
    lexComponent('<!-- <script lang="js"> --><script lang="ts"></script>')
      .typescript,
  ).toBe(true);
});

test("gives parse's offsets after a byte order mark", () => {
  const source = "\ufeff<script>a</script>";
  expect(lexComponent(source).instance?.content).toEqual({ start: 8, end: 9 });
  expect(lexComponent(source)).toEqual(expectedSections(source));
});
