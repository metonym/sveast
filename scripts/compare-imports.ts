import {
  lexImportsExports,
  type Node,
  parseImportsExports,
  parseModule,
} from "../src/index";
import {
  comparableLexed,
  expectedImportsExports,
  expectedLexed,
  MODULE_FILES,
  modulesIn,
} from "./lexed";
import { attempt, compareArgs, errorMessage, report, toJson } from "./shared";

const PROBE = '\nimport "sveast-probe";\n';

const parseModuleBody = (source: string, typescript: boolean) =>
  attempt(() => parseModule(source, { typescript, comments: false }).body);

function probedText(source: string, body: Node[]): string {
  let text = "";
  let last = 0;
  for (const node of body) {
    text += source.slice(last, node.end) + PROBE;
    last = node.end;
  }
  return text + source.slice(last);
}

const starts = (json: string) =>
  json.startsWith("throws")
    ? json
    : (JSON.parse(json) as Node[])
        .map((node) => `${node.type}@${node.start}`)
        .join(" ");

const { files, list } = compareArgs(MODULE_FILES);

let matched = 0;
let rejected = 0;
const mismatches: string[] = [];

for (const file of files) {
  for (const { text: source, typescript } of modulesIn(file)) {
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
      const name = `${file}${body === original ? "" : " (probed)"}`;
      for (const localExports of [true, false]) {
        const nodes = expectedImportsExports(body, localExports);
        const expected = toJson(nodes);
        let actual: string;
        try {
          actual = toJson(
            parseImportsExports(text, { typescript, localExports }),
          );
        } catch (error) {
          actual = `throws ${errorMessage(error)}`;
        }
        if (actual === expected && !localExports) {
          const lexed = toJson(comparableLexed(lexImportsExports(text)));
          const parsed = toJson(expectedLexed(nodes));
          if (lexed !== parsed) {
            mismatches.push(
              `${name}, lexImportsExports\n  sveast: ${lexed.slice(0, 240)}\n  parseImportsExports: ${parsed.slice(0, 240)}`,
            );
            continue;
          }
        }
        if (actual === expected) {
          matched++;
          continue;
        }
        mismatches.push(
          `${name}, localExports: ${localExports}\n  sveast: ${starts(actual).slice(0, 240)}\n  parseModule: ${starts(expected).slice(0, 240)}`,
        );
      }
    }
  }
}

report(
  `${files.length} files: ${matched} match, ${mismatches.length} mismatch, ${rejected} modules parseModule rejects (localExports: false also checks lexImportsExports)`,
  mismatches,
  list,
);
