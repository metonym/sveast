import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { parseArgs } from "node:util";
import { parse } from "sveast";
import { parse as svelteParse } from "svelte/compiler";
import { collectFiles, firstDifference } from "./shared";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    loc: { type: "boolean", default: false },
    ignore: { type: "string", default: "" },
    show: { type: "string", default: "3" },
    list: { type: "boolean", default: false },
  },
});

const LOC_KEYS = new Set(["loc", "name_loc"]);
const ignoreList = values.ignore.split(",").filter(Boolean);
const ignored = new Set(ignoreList.filter((key) => !key.includes(".")));
const ignoredPaths = ignoreList
  .filter((key) => key.includes("."))
  .map((path) => `.${path}`);
if (!values.loc) for (const key of LOC_KEYS) ignored.add(key);

const files = collectFiles(positionals, /\.svelte$/);
const skip = (path: string, key: string) =>
  ignored.has(key) ||
  ignoredPaths.some((suffix) => `${path}.${key}`.endsWith(suffix));

const at = (value: unknown, path: string) =>
  path
    .split(".")
    .slice(1)
    .reduce<unknown>(
      (node, key) => (node as Record<string, unknown> | undefined)?.[key],
      value,
    );

const errorCode = (error: unknown) =>
  (error as { code?: string }).code ?? "(no code)";

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

  let expected: unknown;
  let expectedError: unknown;
  try {
    expected = svelteParse(source, { modern: true });
  } catch (error) {
    expectedError = error;
  }

  let actual: unknown;
  let actualError: unknown;
  try {
    actual = parse(source, values.loc ? { loc: true } : undefined);
  } catch (error) {
    actualError = error;
  }

  if (expectedError && actualError) {
    if (errorCode(expectedError) === errorCode(actualError)) {
      sameCode.push(name);
    } else {
      differentCode.push(
        `${name}: svelte ${errorCode(expectedError)}, sveast ${errorCode(actualError)} (${(actualError as Error).message.split("\n")[0]})`,
      );
    }
    continue;
  }
  if (actualError) {
    onlySveastRejects.push(
      `${name}: ${(actualError as Error).message.split("\n")[0]}`,
    );
    continue;
  }
  if (expectedError) {
    onlySvelteRejects.push(`${name}: ${errorCode(expectedError)}`);
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
    const replacer = (_: string, value: unknown) =>
      typeof value === "bigint" ? `${value}n` : value;
    const shorten = (value: unknown) =>
      JSON.stringify(value, replacer)?.slice(0, 400);
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
  if (list.length === 0) continue;
  console.log(`\n${title}:`);
  for (const line of values.list ? list : list.slice(0, 15))
    console.log(`  ${line}`);
  if (!values.list && list.length > 15)
    console.log(`  ... ${list.length - 15} more`);
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
