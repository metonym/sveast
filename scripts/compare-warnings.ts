import { readFileSync } from "node:fs";
import { compile } from "svelte/compiler";
import { isRunesMode, parse } from "../src/index";
import { compilerWarnings } from "../src/warnings";
import {
  attempt,
  compareArgs,
  errorMessage,
  report,
  resetSvelteBidi,
  SVELTE_FILES,
  WARNING_CODES,
} from "./shared";

const { files, list } = compareArgs(SVELTE_FILES);

interface Found {
  code: string;
  message: string;
  start: number;
  end: number;
}
const key = (w: Found) => `${w.start}-${w.end} ${w.code}: ${w.message}`;

let matched = 0;
let warnings = 0;
let rejected = 0;
const mismatches: string[] = [];

for (const file of files) {
  const source = readFileSync(file, "utf8");
  resetSvelteBidi();
  const expected = attempt(() =>
    compile(source, {
      generate: false,
      experimental: { async: true },
      filename: file,
    })
      .warnings.filter((w) => WARNING_CODES.has(w.code))
      .map((w) => ({
        code: w.code,
        message: w.message,
        start: w.start?.character ?? 0,
        end: w.end?.character ?? 0,
      })),
  );
  const ast = attempt(() => parse(source));
  if (expected === undefined || ast === undefined) {
    rejected++;
    continue;
  }
  let actual: Found[];
  try {
    actual = compilerWarnings(ast, {
      source,
      filename: file,
      runes: isRunesMode(source),
    });
  } catch (error) {
    mismatches.push(`${file}: throws ${errorMessage(error)}`);
    continue;
  }
  const want = expected.map(key).sort((a, b) => a.localeCompare(b));
  const got = actual.map(key).sort((a, b) => a.localeCompare(b));
  warnings += want.length;
  if (want.join("\n") === got.join("\n")) {
    matched++;
  } else {
    const missing = want.filter((w) => !got.includes(w));
    const extra = got.filter((w) => !want.includes(w));
    mismatches.push(
      `${file}:${missing.map((w) => `\n    missing ${w}`).join("")}${extra.map((w) => `\n    extra   ${w}`).join("")}`,
    );
  }
}

report(
  `compilerWarnings matches compile on ${matched} of ${files.length - rejected} components (${warnings} warnings); ${rejected} don't compile or parse`,
  mismatches,
  list,
);
