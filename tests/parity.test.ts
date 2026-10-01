import path from "node:path";
import { Glob } from "bun";
import { type ParseError, parse } from "sveast";
import { parse as svelteParse } from "svelte/compiler";

const root = path.join(import.meta.dir, "corpus");
const files: string[] = [];
for await (const file of new Glob("**/*.svelte").scan(root)) files.push(file);
files.sort();

const WITHOUT_LOC = new Set(["loc", "name_loc"]);

function plain(value: unknown, dropLoc: boolean): unknown {
  return JSON.parse(
    JSON.stringify(value, (key, item) => {
      if (dropLoc && WITHOUT_LOC.has(key)) return undefined;
      return typeof item === "bigint" ? `${item}n` : item;
    }),
  );
}

function error(run: () => unknown) {
  try {
    run();
  } catch (thrown) {
    const { code, message, position, start, end, frame } = thrown as ParseError;
    return { code, message, position, start, end, frame };
  }
  return undefined;
}

test("the corpus is there", () => {
  expect(files.length).toBeGreaterThan(400);
});

describe("parse() matches svelte/compiler", () => {
  for (const file of files) {
    test(file, async () => {
      const source = await Bun.file(path.join(root, file)).text();

      const expectedError = error(() => svelteParse(source, { modern: true }));
      if (expectedError) {
        expect(error(() => parse(source))).toEqual(expectedError);
        return;
      }

      const expected = svelteParse(source, { modern: true });
      expect(plain(parse(source, { loc: true }), false)).toEqual(
        plain(expected, false),
      );
      expect(plain(parse(source), false)).toEqual(plain(expected, true));
    });
  }
});
