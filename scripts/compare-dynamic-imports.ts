import { type LexedDynamicImport, lexDynamicImports } from "../src/index";
import { expectedDynamicImports, MODULE_FILES, modulesIn } from "./lexed";
import { compareArgs, report } from "./shared";

const describe = (call: LexedDynamicImport | undefined) =>
  call === undefined
    ? "nothing"
    : `${call.kind}@${call.start}-${call.end} ${JSON.stringify(call.source?.value ?? null)?.slice(0, 80)}`;

const { files, list } = compareArgs(MODULE_FILES);

let matched = 0;
let rejected = 0;
let calls = 0;
const mismatches: string[] = [];

for (const file of files) {
  for (const { text, typescript } of modulesIn(file)) {
    const expected = expectedDynamicImports(text, typescript);
    if (expected === undefined) {
      rejected++;
      continue;
    }
    const lexed = lexDynamicImports(text);
    const index = lexed.findIndex(
      (call, i) => JSON.stringify(call) !== JSON.stringify(expected[i]),
    );
    if (index === -1 && lexed.length === expected.length) {
      matched++;
      calls += lexed.length;
      continue;
    }
    const at = index === -1 ? lexed.length : index;
    mismatches.push(
      `${file}, call ${at}\n  lexDynamicImports: ${describe(lexed[at])}\n  parseModule: ${describe(expected[at])}`,
    );
  }
}

report(
  `${files.length} files: ${matched} modules match (${calls} calls), ${mismatches.length} mismatch, ${rejected} modules parseModule rejects`,
  mismatches,
  list,
);
