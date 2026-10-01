import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import {
  lexImportsExports,
  type ModuleDeclaration,
  type Node,
  parse,
  parseImportsExports,
  parseModule,
} from "../src/index";
import { comparableLexed, expectedLexed } from "./lexed";
import { collectFiles, errorMessage } from "./shared";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    list: { type: "boolean", default: false },
  },
});

const EXTENSIONS = /\.(?:[cm]?ts|[cm]?js|svelte)$/;
const LANG_TS = /\blang=["']?ts\b/;
const TS_FILE = /\.[cm]?ts$/;
const PROBE = '\nimport "sveast-probe";\n';
const MODULE_TYPES = new Set([
  "ImportDeclaration",
  "ExportNamedDeclaration",
  "ExportDefaultDeclaration",
  "ExportAllDeclaration",
  "TSImportEqualsDeclaration",
  "TSExportAssignment",
  "TSNamespaceExportDeclaration",
]);

const json = (value: unknown) =>
  JSON.stringify(value, (_key, item) =>
    typeof item === "bigint" ? `${item}n` : item,
  );

function isImportOrReexport(node: Node): boolean {
  return node.type === "ExportNamedDeclaration"
    ? node.source !== null && node.source !== undefined
    : node.type === "ImportDeclaration" ||
        node.type === "ExportAllDeclaration" ||
        node.type === "TSImportEqualsDeclaration";
}

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

const files = collectFiles(positionals, EXTENSIONS);

let matched = 0;
let rejected = 0;
const mismatches: string[] = [];

for (const file of files) {
  for (const { source, typescript } of modules(file)) {
    const original = parseModuleBody(source, typescript);
    if (original === undefined) {
      rejected++;
      continue;
    }
    const probed = probedText(source, original);
    const probedBody = parseModuleBody(probed, typescript);
    const inputs: [string, Node[]][] = [[source, original]];
    if (probedBody) inputs.push([probed, probedBody]);
    for (const [text, body] of inputs) {
      const all = body.filter((node) => MODULE_TYPES.has(node.type));
      for (const localExports of [true, false]) {
        const expected = json(
          localExports ? all : all.filter(isImportOrReexport),
        );
        let actual: string;
        try {
          actual = json(
            parseImportsExports(text, { typescript, localExports }),
          );
        } catch (error) {
          actual = `throws ${errorMessage(error)}`;
        }
        if (actual === expected && !localExports) {
          const lexed = json(comparableLexed(lexImportsExports(text)));
          const parsed = json(
            expectedLexed(JSON.parse(expected) as ModuleDeclaration[]),
          );
          if (lexed !== parsed) {
            mismatches.push(
              `${file}${body === original ? "" : " (probed)"}, lexImportsExports\n  sveast: ${lexed.slice(0, 240)}\n  parseImportsExports: ${parsed.slice(0, 240)}`,
            );
            continue;
          }
        }
        if (actual === expected) {
          matched++;
          continue;
        }
        const starts = (list: string) =>
          list.startsWith("throws")
            ? list
            : (JSON.parse(list) as Node[])
                .map((node) => `${node.type}@${node.start}`)
                .join(" ");
        mismatches.push(
          `${file}${body === original ? "" : " (probed)"}, localExports: ${localExports}\n  sveast: ${starts(actual).slice(0, 240)}\n  parseModule: ${starts(expected).slice(0, 240)}`,
        );
      }
    }
  }
}

function parseModuleBody(source: string, typescript: boolean) {
  try {
    return parseModule(source, { typescript, comments: false }).body;
  } catch {
    return;
  }
}

/** The module with an import after each top-level statement, so the scanner's state is checked at every boundary. */
function probedText(source: string, body: Node[]): string {
  let text = "";
  let last = 0;
  for (const node of body) {
    text += source.slice(last, node.end) + PROBE;
    last = node.end;
  }
  return text + source.slice(last);
}

console.log(
  `${files.length} files: ${matched} match, ${mismatches.length} mismatch, ${rejected} modules parseModule rejects (localExports: false also checks lexImportsExports)`,
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
