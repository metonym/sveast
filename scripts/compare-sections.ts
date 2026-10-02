import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { type AST, lexComponent, parse, parseSections } from "../src/index";
import { expectedSections, withoutMarkup } from "./lexed-component";
import { collectFiles, firstDifference, type Json } from "./shared";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    list: { type: "boolean", default: false },
  },
});

const plain = (value: object): Json =>
  JSON.parse(
    JSON.stringify(value, (_key, item) =>
      typeof item === "bigint" ? `${item}n` : item,
    ),
  );

const files = collectFiles(positionals, /\.svelte$/);

let matched = 0;
let rejected = 0;
const mismatches: string[] = [];

for (const file of files) {
  const source = readFileSync(file, "utf8");
  const expected = expectedSections(source);
  if (expected === undefined) {
    rejected++;
    continue;
  }
  const lexed = firstDifference(plain(lexComponent(source)), plain(expected));
  if (lexed !== null) mismatches.push(`${file}, lexComponent: ${lexed}`);
  let markup: string | null = null;
  let full: AST.Root | undefined;
  try {
    full = parse(source);
  } catch {
    full = undefined;
  }
  if (full) {
    try {
      markup = firstDifference(
        plain(parseSections(source)),
        plain(withoutMarkup(full)),
      );
    } catch (error) {
      markup = `throws ${error}`;
    }
  }
  if (markup !== null) mismatches.push(`${file}, parseSections: ${markup}`);
  if (lexed === null && markup === null) matched++;
}

console.log(
  `${files.length} files: ${matched} match, ${mismatches.length} mismatch, ${rejected} parse rejects`,
);
if (mismatches.length > 0) {
  console.log("\nMismatches:");
  for (const line of values.list ? mismatches : mismatches.slice(0, 10)) {
    console.log(line);
  }
  if (!values.list && mismatches.length > 10) {
    console.log(`... ${mismatches.length - 10} more`);
  }
}

process.exitCode = mismatches.length > 0 ? 1 : 0;
