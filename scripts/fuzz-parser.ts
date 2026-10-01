import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Glob } from "bun";

const FIXTURES_DIR = path.join(import.meta.dir, "..", "tests", "corpus");
const DEFAULT_FINDINGS_DIR = path.join(
  import.meta.dir,
  "..",
  ".context",
  "fuzz-findings",
);
const TRIAL_SCRIPT = path.join(import.meta.dir, "fuzz-trial.ts");
const DEFAULT_ITERATIONS = 150;
const SLOW_MS = 1000;
const TRIAL_TIMEOUT_MS = 5000;
const TRIAL_CPU_SECONDS = 10;
const MINIMIZE_TEST_CAP = 60;

interface FuzzArgs {
  iterations: number;
  seed: number;
  findingsDir: string;
}

function parseArgs(argv: string[]): FuzzArgs {
  const args: FuzzArgs = {
    iterations: DEFAULT_ITERATIONS,
    seed: Date.now(),
    findingsDir: DEFAULT_FINDINGS_DIR,
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--iterations") args.iterations = Number(argv[++i]);
    else if (argv[i] === "--seed") args.seed = Number(argv[++i]);
    else if (argv[i] === "--findings-dir")
      args.findingsDir = path.resolve(argv[++i]);
  }
  return args;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;

function randInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[randInt(rng, 0, items.length - 1)];
}

interface Seed {
  file: string;
  source: string;
}

async function loadSeeds(): Promise<Seed[]> {
  const seeds: Seed[] = [];
  for await (const file of new Glob("**/*.svelte").scan(FIXTURES_DIR)) {
    const source = await Bun.file(path.join(FIXTURES_DIR, file)).text();
    seeds.push({ file: file.replace(/\\/g, "/"), source });
  }
  return seeds;
}

interface Mutation {
  source: string;
  tag: string;
}

function mutateTruncate(rng: Rng, seeds: Seed[]): Mutation | null {
  const seed = pick(rng, seeds);
  if (seed.source.length < 4) return null;
  const cut = randInt(rng, 1, seed.source.length - 1);
  return {
    source: seed.source.slice(0, cut),
    tag: `truncate:${cut}/${seed.source.length}:${seed.file}`,
  };
}

const BRACKET_CHAR_REGEX = /[{}<>]/g;

function mutateBracketImbalance(rng: Rng, seeds: Seed[]): Mutation | null {
  const seed = pick(rng, seeds);
  const matches = [...seed.source.matchAll(BRACKET_CHAR_REGEX)];
  if (matches.length === 0) return null;
  const match = pick(rng, matches);
  const idx = match.index;
  const option = pick(rng, ["delete", "duplicate"] as const);
  const mutated =
    option === "delete"
      ? seed.source.slice(0, idx) + seed.source.slice(idx + 1)
      : seed.source.slice(0, idx + 1) + match[0] + seed.source.slice(idx + 1);
  return {
    source: mutated,
    tag: `bracket-imbalance:${option}:${match[0]}:${seed.file}`,
  };
}

const DIRECTIVE_REGEX =
  /\b(on|bind|class|style|use|animate|transition|in|out|let):([a-zA-Z0-9_-]*)(\|[a-zA-Z0-9_-]*)?/g;

function mutateDirectiveMangle(rng: Rng, seeds: Seed[]): Mutation | null {
  const candidates = seeds.filter((s) => DIRECTIVE_REGEX.test(s.source));
  DIRECTIVE_REGEX.lastIndex = 0;
  if (candidates.length === 0) return null;
  const seed = pick(rng, candidates);
  const matches = [...seed.source.matchAll(DIRECTIVE_REGEX)];
  if (matches.length === 0) return null;
  const match = pick(rng, matches);
  const start = match.index;
  const end = start + match[0].length;
  const option = pick(rng, [
    "empty-name",
    "dangling-pipe",
    "unclosed-brace-after",
  ] as const);
  let mutated: string;
  switch (option) {
    case "empty-name":
      mutated = `${seed.source.slice(0, start)}${match[1]}:${seed.source.slice(end)}`;
      break;
    case "dangling-pipe":
      mutated = `${seed.source.slice(0, end)}|${seed.source.slice(end)}`;
      break;
    case "unclosed-brace-after":
      mutated = `${seed.source.slice(0, end)}={${seed.source.slice(end)}`;
      break;
  }
  return { source: mutated, tag: `directive-mangle:${option}:${seed.file}` };
}

const TEMPLATE_INSERT_POINT_REGEX = /<\/script>/;
const SCRIPT_LANG_TS_REGEX = /<script[^>]*\blang\s*=\s*["']ts["']/;

function insertIntoTemplate(source: string, block: string): string | null {
  const matches = [
    ...source.matchAll(new RegExp(TEMPLATE_INSERT_POINT_REGEX, "g")),
  ];
  const last = matches.at(-1);
  const insertAt = last ? last.index + "</script>".length : 0;
  return `${source.slice(0, insertAt)}\n${block}\n${source.slice(insertAt)}`;
}

function mutateBlockNesting(rng: Rng, seeds: Seed[]): Mutation | null {
  const seed = pick(rng, seeds);
  const depth = pick(rng, [10, 25, 50, 100]);
  const kind = pick(rng, ["if", "each"] as const);
  let block: string;
  if (kind === "if") {
    block = `${"{#if true}".repeat(depth)}<span>fuzz</span>${"{/if}".repeat(depth)}`;
  } else {
    block = `${"{#each [1] as fuzzItem}".repeat(depth)}<span>fuzz</span>${"{/each}".repeat(depth)}`;
  }
  const mutated = insertIntoTemplate(seed.source, block);
  if (!mutated) return null;
  return {
    source: mutated,
    tag: `block-nesting:${kind}:${depth}:${seed.file}`,
  };
}

function mutateSnippetMangle(rng: Rng, seeds: Seed[]): Mutation | null {
  const seed = pick(rng, seeds);
  const isTs = SCRIPT_LANG_TS_REGEX.test(seed.source);
  const option = pick(
    rng,
    isTs
      ? ([
          "unclosed-generic",
          "unclosed-paren",
          "nested-generic",
          "empty-generic",
        ] as const)
      : (["unclosed-paren", "no-parens", "extra-parens"] as const),
  );
  let block: string;
  switch (option) {
    case "unclosed-generic":
      block = "{#snippet fuzzSnippet<T(x)}<span>{x}</span>{/snippet}";
      break;
    case "unclosed-paren":
      block = "{#snippet fuzzSnippet(x, y}<span>{x}</span>{/snippet}";
      break;
    case "nested-generic":
      block = `{#snippet fuzzSnippet${"<T".repeat(20)}${">".repeat(20)}(x)}<span>{x}</span>{/snippet}`;
      break;
    case "empty-generic":
      block = "{#snippet fuzzSnippet<>(x)}<span>{x}</span>{/snippet}";
      break;
    case "no-parens":
      block = "{#snippet fuzzSnippet}<span>fuzz</span>{/snippet}";
      break;
    case "extra-parens":
      block = "{#snippet fuzzSnippet((x), (y))}<span>{x}</span>{/snippet}";
      break;
    default:
      block = "{#snippet fuzzSnippet()}<span>fuzz</span>{/snippet}";
  }
  const mutated = insertIntoTemplate(seed.source, block);
  if (!mutated) return null;
  return { source: mutated, tag: `snippet-mangle:${option}:${seed.file}` };
}

function mutateEachAwaitEdge(rng: Rng, seeds: Seed[]): Mutation | null {
  const seed = pick(rng, seeds);
  const option = pick(rng, [
    "each-destructure-unclosed",
    "each-as-collision-comma",
    "each-key-unclosed",
    "await-then-catch-both",
    "await-nested-destructure",
  ] as const);
  let block: string;
  switch (option) {
    case "each-destructure-unclosed":
      block = "{#each fuzzList as { a, b }<span>{a}{b}</span>{/each}";
      break;
    case "each-as-collision-comma":
      block = "{#each fuzzList as fuzzItem, }<span>{fuzzItem}</span>{/each}";
      break;
    case "each-key-unclosed":
      block =
        "{#each fuzzList as fuzzItem (fuzzItem.id}<span>{fuzzItem}</span>{/each}";
      break;
    case "await-then-catch-both":
      block =
        "{#await fuzzPromise then fuzzValue catch fuzzError}<span>{fuzzValue}</span>{/await}";
      break;
    case "await-nested-destructure":
      block =
        "{#await fuzzPromise}...{:then { a: { b } }}<span>{b}</span>{/await}";
      break;
    default:
      block = "{#each fuzzList as fuzzItem}{fuzzItem}{/each}";
  }
  const mutated = insertIntoTemplate(seed.source, block);
  if (!mutated) return null;
  return { source: mutated, tag: `each-await-edge:${option}:${seed.file}` };
}

function mutateWhitespace(rng: Rng, seeds: Seed[]): Mutation | null {
  const seed = pick(rng, seeds);
  const option = pick(rng, [
    "crlf",
    "bom",
    "unicode-word",
    "null-byte",
  ] as const);
  let mutated: string;
  switch (option) {
    case "crlf":
      mutated = seed.source.replace(/\n/g, "\r\n");
      break;
    case "bom":
      mutated = `﻿${seed.source}`;
      break;
    case "unicode-word": {
      const words = [...seed.source.matchAll(/[A-Za-z]{4,}/g)];
      if (words.length === 0) return null;
      const w = pick(rng, words);
      const idx = w.index;
      mutated = `${seed.source.slice(0, idx)}а${seed.source.slice(idx + 1)}`;
      break;
    }
    case "null-byte": {
      const idx = randInt(rng, 0, seed.source.length);
      mutated = `${seed.source.slice(0, idx)}\0${seed.source.slice(idx)}`;
      break;
    }
  }
  return { source: mutated, tag: `whitespace:${option}:${seed.file}` };
}

const OPERATORS: Array<(rng: Rng, seeds: Seed[]) => Mutation | null> = [
  mutateTruncate,
  mutateBracketImbalance,
  mutateDirectiveMangle,
  mutateBlockNesting,
  mutateSnippetMangle,
  mutateEachAwaitEdge,
  mutateWhitespace,
];

interface TrialResult {
  ms: number;
  timedOut: boolean;
  crashed: boolean;
  mismatch: string | null;
}

async function runTrial(source: string): Promise<TrialResult> {
  const proc = Bun.spawn({
    cmd: [
      "bash",
      "-c",
      `ulimit -t ${TRIAL_CPU_SECONDS}; exec bun "${TRIAL_SCRIPT}"`,
    ],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  proc.stdin.write(source);
  await proc.stdin.end();

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill(9);
  }, TRIAL_TIMEOUT_MS);

  const exitCode = await proc.exited;
  clearTimeout(timer);

  if (timedOut) {
    return {
      ms: TRIAL_TIMEOUT_MS,
      timedOut: true,
      crashed: false,
      mismatch: `exceeded ${TRIAL_TIMEOUT_MS}ms`,
    };
  }

  const stdout = await new Response(proc.stdout).text();
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    return {
      ms: 0,
      timedOut: false,
      crashed: true,
      mismatch: `exit ${exitCode}: ${stderr.slice(0, 300)}`,
    };
  }

  try {
    const lastLine = stdout.trim().split("\n").pop() ?? "{}";
    const { ms, mismatch } = JSON.parse(lastLine);
    return { ms, timedOut: false, crashed: false, mismatch };
  } catch {
    return {
      ms: 0,
      timedOut: false,
      crashed: true,
      mismatch: `unreadable trial output: ${stdout.slice(0, 300)}`,
    };
  }
}

function isFinding(result: TrialResult): boolean {
  return result.timedOut || result.crashed || result.mismatch !== null;
}

function severity(result: TrialResult): "hang" | "crash" | "mismatch" {
  if (result.timedOut) return "hang";
  if (result.crashed) return "crash";
  return "mismatch";
}

const REGEX_DIGITS = /\d+/g;

function errorSignature(result: TrialResult): string {
  const detail = (result.mismatch ?? "")
    .split("\n")[0]
    .replace(REGEX_DIGITS, "N")
    .slice(0, 120);
  return `${severity(result)}:${detail}`;
}

async function ddmin(
  lines: string[],
  reproduces: (candidate: string[]) => Promise<boolean>,
): Promise<string[]> {
  let current = lines;
  let n = 2;
  let tests = 0;
  while (current.length >= 2 && tests < MINIMIZE_TEST_CAP) {
    const chunkSize = Math.ceil(current.length / n);
    let reduced = false;
    for (
      let start = 0;
      start < current.length && tests < MINIMIZE_TEST_CAP;
      start += chunkSize
    ) {
      const complement = [
        ...current.slice(0, start),
        ...current.slice(start + chunkSize),
      ];
      tests++;
      // biome-ignore lint/performance/noAwaitInLoops: each ddmin step depends on the previous trial's result.
      if (complement.length > 0 && (await reproduces(complement))) {
        current = complement;
        n = Math.max(n - 1, 2);
        reduced = true;
        break;
      }
    }
    if (!reduced) {
      if (n >= current.length) break;
      n = Math.min(n * 2, current.length);
    }
  }
  return current;
}

interface Finding {
  signature: string;
  tag: string;
  source: string;
  result: TrialResult;
}

async function minimizeFinding(finding: Finding): Promise<string> {
  const targetSignature = finding.signature;
  const reproduces = async (candidateLines: string[]) => {
    const result = await runTrial(candidateLines.join("\n"));
    return isFinding(result) && errorSignature(result) === targetSignature;
  };
  const minimizedLines = await ddmin(finding.source.split("\n"), reproduces);
  return minimizedLines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`fuzz-parser: iterations=${args.iterations} seed=${args.seed}`);

  const seeds = await loadSeeds();
  console.log(`loaded ${seeds.length} seed fixtures`);

  const rng = mulberry32(args.seed);
  const findings = new Map<string, Finding>();
  let matched = 0;
  let slow = 0;
  let applied = 0;

  for (let i = 0; i < args.iterations; i++) {
    const operator = pick(rng, OPERATORS);
    const mutation = operator(rng, seeds);
    if (!mutation) continue;
    applied++;

    // biome-ignore lint/performance/noAwaitInLoops: sequential so a hang only ties up one child
    const result = await runTrial(mutation.source);
    if (result.ms > SLOW_MS) {
      slow++;
      console.log(`[slow] ${result.ms.toFixed(0)}ms tag=${mutation.tag}`);
    }
    if (!isFinding(result)) {
      matched++;
      continue;
    }
    const signature = errorSignature(result);
    if (!findings.has(signature)) {
      findings.set(signature, {
        signature,
        tag: mutation.tag,
        source: mutation.source,
        result,
      });
      console.log(
        `[new finding: ${severity(result)}] ${signature} (from ${mutation.tag})`,
      );
    }

    if ((i + 1) % 25 === 0) {
      console.log(
        `... ${i + 1}/${args.iterations} iterations, ${findings.size} findings, ${matched} matched svelte, ${slow} slow`,
      );
    }
  }

  console.log(
    `\napplied ${applied} mutations, ${matched} matched svelte, ${slow} slow, ${findings.size} unique findings`,
  );

  if (findings.size > 0) {
    mkdirSync(args.findingsDir, { recursive: true });
    const findingPaths: string[] = [];
    for (const finding of findings.values()) {
      // biome-ignore lint/performance/noAwaitInLoops: sequential so minimizing doesn't multiply load
      const minimized = await minimizeFinding(finding);
      const slug = finding.signature
        .replace(/[^a-zA-Z0-9]+/g, "-")
        .toLowerCase()
        .slice(0, 60);
      const filePath = path.join(args.findingsDir, `${slug}.svelte`);
      writeFileSync(filePath, minimized);
      writeFileSync(
        path.join(args.findingsDir, `${slug}.original.svelte`),
        finding.source,
      );
      findingPaths.push(filePath);
      console.log(`\n=== finding: ${finding.signature} ===`);
      console.log(`mutation: ${finding.tag}`);
      console.log(`difference: ${finding.result.mismatch}`);
      console.log(
        `minimized source written to: ${path.relative(process.cwd(), filePath)}`,
      );
    }

    console.log(`\n${findings.size} finding(s):`);
    for (const filePath of findingPaths) {
      console.log(`  ${path.relative(process.cwd(), filePath)}`);
    }
    process.exitCode = 1;
  }
}

await main();
