import path from "node:path";
import { Glob } from "bun";
import { parse } from "sveast";
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
