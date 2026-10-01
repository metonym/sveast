import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { tsPlugin as acornTypeScript } from "@sveltejs/acorn-typescript";
import { type Comment, Parser } from "acorn";
import { tsPlugin } from "../src/ts-plugin";
import { collectFiles, errorMessage } from "./shared";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    "no-loc": { type: "boolean", default: false },
    list: { type: "boolean", default: false },
  },
});

const EXTENSIONS = /\.(?:[cm]?ts|[cm]?js)$/;
const Ours = Parser.extend(tsPlugin);
const Theirs = Parser.extend(acornTypeScript());

function parse(ParserClass: typeof Parser, source: string): string {
  const comments: Comment[] = [];
  const locations = ParserClass === Theirs || !values["no-loc"];
  const ast = ParserClass.parse(source, {
    sourceType: "module",
    ecmaVersion: "latest",
    locations,
    onComment: comments,
  });
  return JSON.stringify({ ast, comments }, (key, value) => {
    if (typeof value === "bigint") return `${value}n`;
    return key === "loc" && values["no-loc"] ? undefined : value;
  });
}

const files = collectFiles(positionals, EXTENSIONS);

let matched = 0;
let bothReject = 0;
const mismatches: string[] = [];
const rejects: string[] = [];
const accepts: string[] = [];

for (const file of files) {
  const source = readFileSync(file, "utf8");
  let expected: string | undefined;
  let expectedError: string | undefined;
  try {
    expected = parse(Theirs, source);
  } catch (error) {
    expectedError = errorMessage(error);
  }
  let actual: string;
  try {
    actual = parse(Ours, source);
  } catch (error) {
    if (expectedError) bothReject++;
    else rejects.push(`${file}: ${errorMessage(error)}`);
    continue;
  }
  if (expected === undefined) {
    accepts.push(`${file}: ${expectedError}`);
    continue;
  }
  if (actual === expected) {
    matched++;
    continue;
  }
  let at = 0;
  while (actual.charCodeAt(at) === expected.charCodeAt(at)) at++;
  mismatches.push(
    `${file}\n  sveast: ...${actual.slice(Math.max(0, at - 80), at + 80)}\n  theirs: ...${expected.slice(Math.max(0, at - 80), at + 80)}`,
  );
}

console.log(
  `${files.length} files: ${matched} match, ${mismatches.length} mismatch, ${bothReject} both reject, ${rejects.length} only acorn-typescript parses, ${accepts.length} only sveast parses`,
);
for (const [title, list] of [
  ["Mismatches", mismatches],
  ["Only acorn-typescript parses", rejects],
  ["Only sveast parses", accepts],
] as const) {
  if (list.length === 0) continue;
  console.log(`\n${title}:`);
  for (const line of values.list ? list : list.slice(0, 10)) console.log(line);
  if (!values.list && list.length > 10)
    console.log(`... ${list.length - 10} more`);
}

process.exitCode =
  mismatches.length + rejects.length + accepts.length > 0 ? 1 : 0;
