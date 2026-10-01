import { parse as svelteParse } from "svelte/compiler";
import { parse } from "../src/index";
import {
  errorCode,
  errorMessage,
  firstDifference,
  isRecord,
  type Json,
} from "./shared";

async function readStdin(): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of Bun.stdin.stream()) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

const source = await readStdin();

if (process.env.SVEAST_FUZZ_FORCE_CRASH === "1") process.exit(1);

type Outcome =
  | { ok: true; ast: object }
  | { ok: false; code: string; position?: number[]; message: string };

function run(parser: () => object): Outcome {
  try {
    return { ok: true, ast: parser() };
  } catch (error) {
    const position =
      isRecord(error) && Array.isArray(error.position)
        ? error.position
        : undefined;
    return {
      ok: false,
      code: errorCode(error) ?? "(none)",
      position,
      message: errorMessage(error),
    };
  }
}

function plain(value: object, dropLoc: boolean): Json {
  return JSON.parse(
    JSON.stringify(value, (key, item) => {
      if (typeof item === "bigint") return `${item}n`;
      return dropLoc && (key === "loc" || key === "name_loc")
        ? undefined
        : item;
    }),
  );
}

function compare(ours: Outcome, theirs: Outcome, dropLoc: boolean) {
  if (ours.ok) {
    if (!theirs.ok) return `accepts what svelte rejects (${theirs.code})`;
    const path = firstDifference(
      plain(ours.ast, dropLoc),
      plain(theirs.ast, dropLoc),
    );
    return path === null
      ? null
      : `ast differs at ${path.replace(/\.\d+/g, "[]") || "(root)"}`;
  }
  if (theirs.ok) {
    return `rejects (${ours.code}: ${ours.message.split("\n")[0]})`;
  }
  if (ours.code !== theirs.code) {
    return `error ${ours.code} where svelte has ${theirs.code}`;
  }
  if (String(ours.position) !== String(theirs.position)) {
    return `error ${ours.code} at a different position`;
  }
  return null;
}

const svelte = run(() => svelteParse(source, { modern: true }));
const t0 = performance.now();
const withLoc = run(() => parse(source, { loc: true }));
const ms = performance.now() - t0;
const withoutLoc = run(() => parse(source));

const mismatch =
  compare(withLoc, svelte, false) ??
  (compare(withoutLoc, svelte, true) &&
    `without loc: ${compare(withoutLoc, svelte, true)}`);
console.log(JSON.stringify({ ms, mismatch }));
