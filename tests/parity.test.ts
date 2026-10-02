import { readFileSync } from "node:fs";
import path from "node:path";
import { Glob } from "bun";
import { type AST, parse, parseSections } from "sveast";
import { parse as svelteParse } from "svelte/compiler";
import { withoutMarkup } from "../scripts/lexed-component";
import { byCodeUnit, isRecord, type Json } from "../scripts/shared";

const root = path.join(import.meta.dir, "corpus");
const files: string[] = [];
for await (const file of new Glob("**/*.svelte").scan(root)) files.push(file);
files.sort(byCodeUnit);

const WITHOUT_LOC = new Set(["loc", "name_loc"]);

function plain(
  value: object,
  dropLoc: boolean,
  drop: ReadonlySet<string> = dropLoc ? WITHOUT_LOC : new Set(),
): Json {
  return JSON.parse(
    JSON.stringify(value, (key, item) => {
      if (typeof item === "bigint") return `${item}n`;
      return drop.has(key) ? undefined : item;
    }),
  );
}

function outcome(
  run: () => object,
  dropLoc: boolean,
  drop?: ReadonlySet<string>,
) {
  try {
    return { ast: plain(run(), dropLoc, drop) };
  } catch (thrown) {
    if (!isRecord(thrown)) throw thrown;
    const { code, message, position, start, end, frame } = thrown;
    return { error: { code, message, position, start, end, frame } };
  }
}

test("the corpus is there", () => {
  expect(files.length).toBeGreaterThan(400);
});

describe("parse() matches svelte/compiler", () => {
  for (const file of files) {
    test(file, async () => {
      const source = await Bun.file(path.join(root, file)).text();

      const theirs = () => svelteParse(source, { modern: true });
      expect(outcome(() => parse(source, { loc: true }), false)).toEqual(
        outcome(theirs, false),
      );
      expect(outcome(() => parse(source), false)).toEqual(
        outcome(theirs, true),
      );
    });
  }
});

/** `ast` as `parse(source, { script: false })` should give it: no statements or comments from the scripts. */
function withoutScripts(ast: AST.Root): AST.Root {
  const ranges: [number, number][] = [];
  const skip = (script: AST.Script | undefined): AST.Script | undefined => {
    if (!script) return script;
    const { start, end } = script.content;
    ranges.push([start, end]);
    const { trailingComments: _, ...content } = script.content;
    // the HTML comment before the tag is the only one without offsets, and
    // plain() drops an undefined field
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
  for (const file of files) {
    const source = readFileSync(path.join(root, file), "utf8");
    for (const loc of [false, true]) {
      let full: AST.Root;
      try {
        full = parse(source, { loc });
      } catch {
        continue;
      }
      const skipped = plain(parse(source, { loc, script: false }), false);
      if (!Bun.deepEquals(skipped, plain(withoutScripts(full), false))) {
        mismatched.push(`${file}${loc ? " (loc)" : ""}`);
      }
      compared++;
    }
  }
  expect(mismatched).toEqual([]);
  expect(compared).toBeGreaterThan(700);
});

/** Whether `parseSections(source)` gives `parse(source)` without its markup; `undefined` if `parse` throws. */
function matchesWithoutMarkup(
  source: string,
  options: { loc: boolean; script?: boolean },
): boolean | undefined {
  let full: AST.Root;
  try {
    full = parse(source, options);
  } catch {
    return undefined;
  }
  const skipped = outcome(() => parseSections(source, options), false);
  return Bun.deepEquals(skipped, { ast: plain(withoutMarkup(full), false) });
}

test("parseSections gives the AST without the markup and its comments", () => {
  const mismatched: string[] = [];
  let compared = 0;
  for (const file of files) {
    const source = readFileSync(path.join(root, file), "utf8");
    for (const options of [
      { loc: false },
      { loc: true },
      { loc: false, script: false },
    ]) {
      const matches = matchesWithoutMarkup(source, options);
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
  const sources = files.map((file) =>
    readFileSync(path.join(root, file), "utf8"),
  );
  let seed = 1;
  const random = (n: number) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  const mismatched: string[] = [];
  let compared = 0;
  for (let trial = 0; trial < 6000; trial++) {
    let source = sources[random(sources.length)].slice(0, 4000);
    for (let edits = 1 + random(3); edits > 0; edits--) {
      const at = random(source.length + 1);
      const edit = MARKUP_EDITS[random(MARKUP_EDITS.length)];
      const removed = random(3) === 0 ? 0 : 1 + random(5);
      source = source.slice(0, at) + edit + source.slice(at + removed);
    }
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
  for (const file of files) {
    const source = readFileSync(path.join(root, file), "utf8");
    for (const loc of [false, true]) {
      const expected = outcome(
        () => {
          const full = parse(source, { loc });
          if (full.comments.length > 0) withComments++;
          return { ...full, comments: [] };
        },
        false,
        ATTACHED_COMMENTS,
      );
      const skipped = outcome(
        () => parse(source, { loc, comments: false }),
        false,
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
