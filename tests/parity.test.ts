import { type AST, parse, parseSections } from "sveast";
import { withoutMarkup } from "../scripts/lexed-component";
import { attempt, plain, SVELTE_FILES } from "../scripts/shared";
import {
  corpusFiles,
  mutated,
  outcome,
  readCorpus,
  svelteParity,
} from "./shared";

const files = corpusFiles(SVELTE_FILES);
const sources = files.map((file) => readCorpus(file));

test("the corpus is there", () => {
  expect(files.length).toBeGreaterThan(400);
});

describe("parse() matches svelte/compiler", () => {
  for (const [i, file] of files.entries()) {
    test(file, () => {
      const { ours, theirs } = svelteParity(sources[i]);
      expect(ours).toEqual(theirs);
    });
  }
});

function withoutScripts(ast: AST.Root): AST.Root {
  const ranges: [number, number][] = [];
  const skip = (script: AST.Script | undefined): AST.Script | undefined => {
    if (!script) return script;
    const { start, end } = script.content;
    ranges.push([start, end]);
    const { trailingComments: _, ...content } = script.content;
    const html = content.leadingComments?.filter((c) => !("start" in c));
    content.leadingComments = html?.length ? html : undefined;
    return { ...script, content: { ...content, body: [] } };
  };
  const instance = skip(ast.instance);
  const module = skip(ast.module);
  const comments = ast.comments.filter(
    (comment) =>
      !ranges.some(
        ([start, end]) => comment.start >= start && comment.end <= end,
      ),
  );
  return { ...ast, instance, module, comments };
}

test("`script: false` gives the AST without the scripts' statements and comments", () => {
  const mismatched: string[] = [];
  let compared = 0;
  for (const [i, file] of files.entries()) {
    for (const loc of [false, true]) {
      const full = attempt(() => parse(sources[i], { loc }));
      if (!full) continue;
      const skipped = plain(parse(sources[i], { loc, script: false }));
      if (!Bun.deepEquals(skipped, plain(withoutScripts(full)))) {
        mismatched.push(`${file}${loc ? " (loc)" : ""}`);
      }
      compared++;
    }
  }
  expect(mismatched).toEqual([]);
  expect(compared).toBeGreaterThan(700);
});

function matchesWithoutMarkup(
  source: string,
  options: { loc: boolean; script?: boolean },
): boolean | undefined {
  const full = attempt(() => parse(source, options));
  if (!full) return;
  const skipped = outcome(() => parseSections(source, options));
  return Bun.deepEquals(skipped, { ast: plain(withoutMarkup(full)) });
}

test("parseSections gives the AST without the markup and its comments", () => {
  const mismatched: string[] = [];
  let compared = 0;
  for (const [i, file] of files.entries()) {
    for (const options of [
      { loc: false },
      { loc: true },
      { loc: false, script: false },
    ]) {
      const matches = matchesWithoutMarkup(sources[i], options);
      if (matches === undefined) continue;
      if (!matches) mismatched.push(`${file} ${JSON.stringify(options)}`);
      compared++;
    }
  }
  expect(mismatched).toEqual([]);
  expect(compared).toBeGreaterThan(1000);
});

const MARKUP_EDITS = [
  "<script>",
  "</script>",
  "<script module>",
  "<style>",
  "</style>",
  "<svelte:options runes />",
  "<svelte:head>",
  "<div>",
  "</div>",
  "<p>",
  "<!--",
  "-->",
  "<!-- a -->",
  "{",
  "}",
  "{#if a}",
  "{/if}",
  '"',
  "`",
  "//",
  "\n",
];

test("parseSections gives the AST without the markup on mutated components", () => {
  const mismatched: string[] = [];
  let compared = 0;
  for (const [source] of mutated(sources, MARKUP_EDITS, 6000)) {
    const matches = matchesWithoutMarkup(source, { loc: false });
    if (matches === undefined) continue;
    if (!matches) mismatched.push(source);
    compared++;
  }
  expect(mismatched).toEqual([]);
  expect(compared).toBeGreaterThan(800);
});

const ATTACHED_COMMENTS = new Set(["leadingComments", "trailingComments"]);

test("`comments: false` gives the AST without its JavaScript comments", () => {
  const mismatched: string[] = [];
  let compared = 0;
  let withComments = 0;
  for (const [i, file] of files.entries()) {
    for (const loc of [false, true]) {
      const expected = outcome(() => {
        const full = parse(sources[i], { loc });
        if (full.comments.length > 0) withComments++;
        return { ...full, comments: [] };
      }, ATTACHED_COMMENTS);
      const skipped = outcome(() =>
        parse(sources[i], { loc, comments: false }),
      );
      if (!Bun.deepEquals(skipped, expected)) {
        mismatched.push(`${file}${loc ? " (loc)" : ""}`);
      }
      compared++;
    }
  }
  expect(mismatched).toEqual([]);
  expect(compared).toBeGreaterThan(800);
  expect(withComments).toBeGreaterThan(200);
});
