import { readFileSync } from "node:fs";
import { lexComponent, parse, parseSections } from "../src/index";
import { expectedSections, withoutMarkup } from "./lexed-component";
import {
  attempt,
  compareArgs,
  firstDifference,
  plain,
  report,
  SVELTE_FILES,
} from "./shared";

const { files, list } = compareArgs(SVELTE_FILES);

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
  const full = attempt(() => parse(source));
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

report(
  `${files.length} files: ${matched} match, ${mismatches.length} mismatch, ${rejected} parse rejects`,
  mismatches,
  list,
);
