import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { compile } from "svelte/compiler";
import { isRunesMode } from "../src/index";
import { collectFiles, errorMessage } from "./shared";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    list: { type: "boolean", default: false },
  },
});

const files = collectFiles(positionals, /\.svelte$/);

let matched = 0;
let runes = 0;
let rejected = 0;
const mismatches: string[] = [];

for (const file of files) {
  const source = readFileSync(file, "utf8");
  let expected: boolean;
  try {
    expected = compile(source, {
      generate: false,
      experimental: { async: true },
    }).metadata.runes;
  } catch {
    rejected++;
    continue;
  }
  let actual: boolean | string;
  try {
    actual = isRunesMode(source);
  } catch (error) {
    actual = `throws ${errorMessage(error)}`;
  }
  if (actual === expected) {
    matched++;
    if (expected) runes++;
  } else {
    mismatches.push(`${file}: sveast ${actual}, svelte ${expected}`);
  }
}

console.log(
  `${files.length} files: ${matched} match (${runes} in runes mode), ${mismatches.length} mismatch, ${rejected} compile rejects`,
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
