import { readFileSync } from "node:fs";
import { compile } from "svelte/compiler";
import { isRunesMode } from "../src/index";
import {
  attempt,
  compareArgs,
  errorMessage,
  report,
  SVELTE_FILES,
} from "./shared";

const { files, list } = compareArgs(SVELTE_FILES);

let matched = 0;
let runes = 0;
let rejected = 0;
const mismatches: string[] = [];

for (const file of files) {
  const source = readFileSync(file, "utf8");
  const expected = attempt(
    () =>
      compile(source, { generate: false, experimental: { async: true } })
        .metadata.runes,
  );
  if (expected === undefined) {
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

report(
  `${files.length} files: ${matched} match (${runes} in runes mode), ${mismatches.length} mismatch, ${rejected} compile rejects`,
  mismatches,
  list,
);
