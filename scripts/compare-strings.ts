import { type LexedString, lexStrings } from "../src/index";
import { expectedStrings, MODULE_FILES, modulesIn } from "./lexed";
import { compareArgs, report } from "./shared";

const describe = (string: LexedString | undefined) =>
  string === undefined
    ? "nothing"
    : `${string.kind}@${string.start}-${string.end} ${JSON.stringify(string.value)?.slice(0, 80)}`;

const { files, list } = compareArgs(MODULE_FILES);

let matched = 0;
let rejected = 0;
let strings = 0;
const mismatches: string[] = [];

for (const file of files) {
  for (const { text, typescript } of modulesIn(file)) {
    const expected = expectedStrings(text, typescript);
    if (expected === undefined) {
      rejected++;
      continue;
    }
    const lexed = lexStrings(text);
    const index = lexed.findIndex(
      (string, i) => JSON.stringify(string) !== JSON.stringify(expected[i]),
    );
    if (index === -1 && lexed.length === expected.length) {
      matched++;
      strings += lexed.length;
      continue;
    }
    const at = index === -1 ? lexed.length : index;
    mismatches.push(
      `${file}, string ${at}\n  lexStrings: ${describe(lexed[at])}\n  parseModule: ${describe(expected[at])}`,
    );
  }
}

report(
  `${files.length} files: ${matched} modules match (${strings} strings), ${mismatches.length} mismatch, ${rejected} modules parseModule rejects`,
  mismatches,
  list,
);
