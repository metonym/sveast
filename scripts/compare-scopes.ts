import { readFileSync } from "node:fs";
import { compareArgs, report, SVELTE_FILES } from "./shared";
import { compareScopes } from "./svelte-scopes";

const { files, list } = compareArgs(SVELTE_FILES);

let compared = 0;
let names = 0;
let rejected = 0;
const mismatches: string[] = [];

for (const file of files) {
  const result = compareScopes(readFileSync(file, "utf8"));
  if (!result) {
    rejected++;
    continue;
  }
  compared++;
  names += result.compared;
  for (const mismatch of result.mismatches) {
    mismatches.push(`${file}: ${mismatch}`);
  }
}

report(
  `${files.length} files: ${compared} compared (${names} names), ${mismatches.length} mismatches, ${rejected} rejected`,
  mismatches,
  list,
);
