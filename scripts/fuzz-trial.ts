import { parse as svelteParse } from "svelte/compiler";
import { parse } from "../src/index";
import { firstDifference } from "./shared";

async function readStdin(): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of Bun.stdin.stream()) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

const source = await readStdin();

if (process.env.SVEAST_FUZZ_FORCE_CRASH === "1") process.exit(1);

type Outcome =
  | { ok: true; ast: unknown }
  | { ok: false; code: string; position?: number[]; message: string };

function run(parser: () => unknown): Outcome {
  try {
    return { ok: true, ast: parser() };
  } catch (error) {
    const { code, position, message } = error as {
      code?: string;
      position?: number[];
      message: string;
    };
    return { ok: false, code: code ?? "(none)", position, message };
  }
}

function plain(value: unknown, dropLoc: boolean): unknown {
  return JSON.parse(
    JSON.stringify(value, (key, item) => {
      if (dropLoc && (key === "loc" || key === "name_loc")) return undefined;
      return typeof item === "bigint" ? `${item}n` : item;
    }),
  );
}

function compare(ours: Outcome, svelte: Outcome, dropLoc: boolean) {
  if (ours.ok && svelte.ok) {
    const path = firstDifference(
      plain(ours.ast, dropLoc),
      plain(svelte.ast, dropLoc),
    );
    return path === null
      ? null
      : `ast differs at ${path.replace(/\.\d+/g, "[]") || "(root)"}`;
  }
  if (!ours.ok && !svelte.ok) {
    if (ours.code !== svelte.code) {
      return `error ${ours.code} where svelte has ${svelte.code}`;
    }
    if (String(ours.position) !== String(svelte.position)) {
      return `error ${ours.code} at a different position`;
    }
    return null;
  }
  if (!ours.ok) return `rejects (${ours.code}: ${ours.message.split("\n")[0]})`;
  return `accepts what svelte rejects (${(svelte as { code: string }).code})`;
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
