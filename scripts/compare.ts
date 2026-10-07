import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { parseArgs } from "node:util";
import { parse } from "sveast";
import { parse as svelteParse } from "svelte/compiler";
import {
  collectFiles,
  errorCode,
  errorMessage,
  firstDifference,
  isRecord,
  LOC_KEYS,
  printList,
  SVELTE_FILES,
  toJson,
} from "./shared";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    loc: { type: "boolean", default: false },
    ignore: { type: "string", default: "" },
    show: { type: "string", default: "3" },
    list: { type: "boolean", default: false },
  },
});

const ignoreList = values.ignore.split(",").filter(Boolean);
const ignored = new Set(ignoreList.filter((key) => !key.includes(".")));
const ignoredPaths = ignoreList
  .filter((key) => key.includes("."))
  .map((path) => `.${path}`);
if (!values.loc) for (const key of LOC_KEYS) ignored.add(key);

const files = collectFiles(positionals, SVELTE_FILES);
const skip = (path: string, key: string) =>
  ignored.has(key) ||
  ignoredPaths.some((suffix) => `${path}.${key}`.endsWith(suffix));

const at = (value: unknown, path: string) =>
  path
    .split(".")
    .slice(1)
    .reduce<unknown>(
      (node, key) => (isRecord(node) ? node[key] : undefined),
      value,
    );

const codeOf = (error: unknown) => errorCode(error) ?? "(no code)";

let matched = 0;
const mismatches = new Map<string, string[]>();
const examples: string[] = [];
const onlySveastRejects: string[] = [];
const onlySvelteRejects: string[] = [];
const sameCode: string[] = [];
const differentCode: string[] = [];

for (const file of files) {
  const source = readFileSync(file, "utf8");
  const name = relative(process.cwd(), file);

  let expected: object | undefined;
  let expectedError: unknown;
  try {
    expected = svelteParse(source, { modern: true });
  } catch (error) {
    expectedError = error;
  }

  let actual: object | undefined;
  let actualError: unknown;
  try {
    actual = parse(source, values.loc ? { loc: true } : undefined);
  } catch (error) {
    actualError = error;
  }

  if (expectedError && actualError) {
    if (codeOf(expectedError) === codeOf(actualError)) {
      sameCode.push(name);
    } else {
      differentCode.push(
        `${name}: svelte ${codeOf(expectedError)}, sveast ${codeOf(actualError)} (${errorMessage(actualError).split("\n")[0]})`,
      );
    }
    continue;
  }
  if (actualError) {
    onlySveastRejects.push(
      `${name}: ${errorMessage(actualError).split("\n")[0]}`,
    );
    continue;
  }
  if (expectedError) {
    onlySvelteRejects.push(`${name}: ${codeOf(expectedError)}`);
    continue;
  }

  const difference = firstDifference(actual, expected, skip);
  if (!difference) {
    matched++;
    continue;
  }
  const group = difference.replace(/\.\d+/g, "[]");
  const list = mismatches.get(group) ?? [];
  list.push(name);
  mismatches.set(group, list);
  if (examples.length < Number(values.show)) {
    const shorten = (value: unknown) => String(toJson(value)).slice(0, 400);
    examples.push(
      `${name} at ${difference}\n  sveast: ${shorten(at(actual, difference))}\n  svelte: ${shorten(at(expected, difference))}`,
    );
  }
}

const total = files.length;
const astMismatches = [...mismatches.values()].reduce(
  (n, l) => n + l.length,
  0,
);
console.log(
  `${total} files: ${matched} match, ${astMismatches} AST mismatches, ` +
    `${sameCode.length} both reject with the same code, ${differentCode.length} with different codes, ` +
    `${onlySveastRejects.length} only sveast rejects, ${onlySvelteRejects.length} only svelte rejects`,
);

const sorted = [...mismatches].sort((a, b) => b[1].length - a[1].length);
if (sorted.length > 0) {
  console.log("\nAST mismatches by first differing path:");
  for (const [group, list] of sorted) {
    console.log(`  ${String(list.length).padStart(5)}  ${group}  (${list[0]})`);
    if (values.list)
      for (const file of list.slice(1)) console.log(`         ${file}`);
  }
}
for (const [title, list] of [
  ["Only sveast rejects", onlySveastRejects],
  ["Only svelte rejects", onlySvelteRejects],
  ["Different error codes", differentCode],
] as const) {
  printList(title, list, values.list, 15, "  ");
}
if (examples.length > 0) console.log(`\nExamples:\n${examples.join("\n")}`);

process.exitCode =
  astMismatches +
    differentCode.length +
    onlySveastRejects.length +
    onlySvelteRejects.length >
  0
    ? 1
    : 0;
