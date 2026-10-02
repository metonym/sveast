import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createLocator, parse, walk } from "sveast";
import { byCodeUnit } from "../scripts/shared";

const CORPUS = join(import.meta.dir, "corpus");
const NON_LF_LINE_BREAK = /\r(?!\n)|[\u2028\u2029]/;

function components(): [path: string, source: string][] {
  return readdirSync(CORPUS, { recursive: true, encoding: "utf8" })
    .filter((path) => path.endsWith(".svelte"))
    .sort(byCodeUnit)
    .map((path) => [path, readFileSync(join(CORPUS, path), "utf8")]);
}

test("gives each node's loc on the corpus", () => {
  let checked = 0;
  for (const [path, source] of components()) {
    if (NON_LF_LINE_BREAK.test(source) || source.charCodeAt(0) === 0xfeff) {
      continue;
    }
    let ast: ReturnType<typeof parse>;
    try {
      ast = parse(source, { loc: true });
    } catch {
      continue;
    }
    const locate = createLocator(source);
    const mismatches: string[] = [];
    walk(ast, {
      enter(node) {
        if (node.type === "Program" || !("loc" in node) || !node.loc) return;
        checked++;
        const { start, end } = node.loc;
        const found = { start: locate(node.start), end: locate(node.end) };
        if (
          found.start.line !== start.line ||
          found.start.column !== start.column ||
          found.end.line !== end.line ||
          found.end.column !== end.column
        ) {
          mismatches.push(`${node.type} at ${node.start}`);
        }
      },
    });
    expect([path, mismatches]).toEqual([path, []]);
  }
  expect(checked).toBeGreaterThan(50_000);
});

test("counts lines from 1 and columns from 0, in any order of lookups", () => {
  const locate = createLocator("ab\ncd\r\n\nef");
  expect(locate(10)).toEqual({ line: 4, column: 2 });
  expect(locate(0)).toEqual({ line: 1, column: 0 });
  expect(locate(2)).toEqual({ line: 1, column: 2 });
  expect(locate(3)).toEqual({ line: 2, column: 0 });
  expect(locate(6)).toEqual({ line: 2, column: 3 });
  expect(locate(7)).toEqual({ line: 3, column: 0 });
  expect(locate(8)).toEqual({ line: 4, column: 0 });
  expect(locate(11)).toEqual({ line: 4, column: 3 });
});

test("ends lines only at \\n", () => {
  const locate = createLocator("a\rb\u2028c");
  expect(locate(4)).toEqual({ line: 1, column: 4 });
});

test("keeps each locator's lines apart", () => {
  const first = createLocator("a\nb");
  const second = createLocator("a\n\n\nb");
  expect(first(2)).toEqual({ line: 2, column: 0 });
  expect(second(4)).toEqual({ line: 4, column: 0 });
  expect(first(2)).toEqual({ line: 2, column: 0 });
});
