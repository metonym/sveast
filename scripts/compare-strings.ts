import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { type LexedString, lexStrings, parse, parseModule } from "../src/index";
import { expectedStrings } from "./lexed";
import { collectFiles } from "./shared";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    list: { type: "boolean", default: false },
  },
});

const EXTENSIONS = /\.(?:[cm]?ts|[cm]?js|svelte)$/;
const LANG_TS = /\blang=["']?ts\b/;
const TS_FILE = /\.[cm]?ts$/;

function modules(file: string): { source: string; typescript: boolean }[] {
  const source = readFileSync(file, "utf8");
  if (!file.endsWith(".svelte")) {
    return [{ source, typescript: TS_FILE.test(file) }];
  }
  let ast: ReturnType<typeof parse>;
  try {
    ast = parse(source, { script: false });
  } catch {
    return [];
  }
  return [ast.instance, ast.module].flatMap((script) =>
    script
      ? [
          {
            source: source.slice(script.content.start, script.content.end),
            typescript: LANG_TS.test(
              source.slice(script.start, script.content.start),
            ),
          },
        ]
      : [],
  );
}

const describe = (string: LexedString | undefined) =>
  string === undefined
    ? "nothing"
    : `${string.kind}@${string.start}-${string.end} ${JSON.stringify(string.value)?.slice(0, 80)}`;

const files = collectFiles(positionals, EXTENSIONS);

let matched = 0;
let rejected = 0;
let strings = 0;
const mismatches: string[] = [];

for (const file of files) {
  for (const { source, typescript } of modules(file)) {
    let expected: LexedString[];
    try {
      expected = expectedStrings(
        parseModule(source, { typescript, comments: false }),
      );
    } catch {
      rejected++;
      continue;
    }
    const lexed = lexStrings(source);
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

console.log(
  `${files.length} files: ${matched} modules match (${strings} strings), ${mismatches.length} mismatch, ${rejected} modules parseModule rejects`,
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
