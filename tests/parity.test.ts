import { readFileSync } from "node:fs";
import path from "node:path";
import { Glob } from "bun";
import { type AST, parse } from "sveast";
import { parse as svelteParse } from "svelte/compiler";
import { byCodeUnit, isRecord, type Json } from "../scripts/shared";

const root = path.join(import.meta.dir, "corpus");
const files: string[] = [];
for await (const file of new Glob("**/*.svelte").scan(root)) files.push(file);
files.sort(byCodeUnit);

const WITHOUT_LOC = new Set(["loc", "name_loc"]);

function plain(value: object, dropLoc: boolean): Json {
  return JSON.parse(
    JSON.stringify(value, (key, item) => {
      if (typeof item === "bigint") return `${item}n`;
      return dropLoc && WITHOUT_LOC.has(key) ? undefined : item;
    }),
  );
}

function outcome(run: () => object, dropLoc: boolean) {
  try {
    return { ast: plain(run(), dropLoc) };
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
