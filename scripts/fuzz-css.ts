// A differential fuzzer for `css_unused_selector`: it generates components
// with random markup and random selectors, and checks that
// `compilerWarnings` gives the warnings svelte's `compile` gives.
//
//   bun scripts/fuzz-css.ts [--iterations 5000] [--seed 1] [--findings-dir dir]
//
// It writes each component that doesn't match to the findings directory.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compile } from "svelte/compiler";
import { isRunesMode, parse } from "../src/index";
import { compilerWarnings } from "../src/warnings";
import { attempt, errorMessage, mulberry32 } from "./shared";

type Rng = () => number;

const args = process.argv.slice(2);
const flag = (name: string, fallback: number) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : Number(args[i + 1]);
};
const iterations = flag("--iterations", 5000);
const seed = flag("--seed", Date.now() % 1e9);
const findingsIndex = args.indexOf("--findings-dir");
const findingsDir = findingsIndex === -1 ? null : args[findingsIndex + 1];

// Tags to select. The markup nests only the first six: `<a>` in `<a>` or
// `<li>` in `<li>` doesn't compile.
const TAGS = ["div", "span", "section", "ul", "b", "input", "a", "li"];
const CONTAINERS = TAGS.slice(0, 6);
const CLASSES = ["x", "y", "z"];
const SNIPPETS = ["s1", "s2"];

const int = (rng: Rng, max: number) => Math.floor(rng() * max);
const pick = <T>(rng: Rng, items: readonly T[]): T =>
  items[int(rng, items.length)];
const chance = (rng: Rng, p: number) => rng() < p;

const NAME_END = /[={]/;

function attributes(rng: Rng): string {
  const out: string[] = [];
  const n = int(rng, 3);
  for (let i = 0; i < n; i++) {
    switch (int(rng, 12)) {
      case 0:
        out.push(`class="${pick(rng, CLASSES)}"`);
        break;
      case 1:
        out.push(`class="${pick(rng, CLASSES)} ${pick(rng, CLASSES)}"`);
        break;
      case 2:
        out.push(
          `class={c ? "${pick(rng, CLASSES)}" : "${pick(rng, CLASSES)}"}`,
        );
        break;
      case 3:
        out.push(`class:${pick(rng, CLASSES)}={c}`);
        break;
      case 4:
        out.push(`id="${pick(rng, CLASSES)}"`);
        break;
      case 5:
        out.push(`data-k="${pick(rng, ["v", "V", "v w"])}"`);
        break;
      case 6:
        out.push("{...rest}");
        break;
      case 7:
        out.push(`class="${pick(rng, CLASSES)}-{c}"`);
        break;
      case 8:
        out.push(
          `class={[c && "${pick(rng, CLASSES)}", "${pick(rng, CLASSES)}"]}`,
        );
        break;
      case 9:
        out.push(`type="${pick(rng, ["text", "TEXT"])}"`);
        break;
      case 10:
        out.push("data-k");
        break;
      default:
        out.push(`class={{ ${pick(rng, CLASSES)}: c }}`);
    }
  }
  // svelte rejects a repeated attribute.
  const seen = new Set<string>();
  const unique = out.filter((a) => {
    const name = a.startsWith("{...") ? a : a.split(NAME_END)[0];
    if (seen.has(name)) return false;
    seen.add(name);
    return true;
  });
  return unique.length > 0 ? ` ${unique.join(" ")}` : "";
}

// A component can't use both `<slot>` and `{@render}`.
let slots = false;

function fragment(rng: Rng, depth: number, inSelect = false): string {
  const n = depth > 3 ? int(rng, 2) : 1 + int(rng, 3);
  let out = "";
  for (let i = 0; i < n; i++) out += node(rng, depth, inSelect);
  return out;
}

function node(rng: Rng, depth: number, inSelect: boolean): string {
  const inner = () => (depth > 3 ? "" : fragment(rng, depth + 1, inSelect));
  if (inSelect) {
    switch (int(rng, 4)) {
      case 0:
        return `<option${attributes(rng)}>${chance(rng, 0.5) ? `<span${attributes(rng)}></span>` : "t"}</option>`;
      case 1:
        return "<selectedcontent></selectedcontent>";
      case 2:
        return `<button${attributes(rng)}><selectedcontent></selectedcontent></button>`;
      default:
        return `{#if c}<option${attributes(rng)}><span${attributes(rng)}></span></option>{/if}`;
    }
  }
  switch (int(rng, 18)) {
    case 0:
    case 1:
    case 2:
    case 3: {
      const tag = pick(rng, CONTAINERS);
      if (tag === "input") return `<input${attributes(rng)} />`;
      return `<${tag}${attributes(rng)}>${inner()}</${tag}>`;
    }
    case 4:
      return `{#if c}${inner()}${chance(rng, 0.5) ? `{:else}${inner()}` : ""}{/if}`;
    case 5:
      return `{#each items as item}${inner()}${chance(rng, 0.3) ? `{:else}${inner()}` : ""}{/each}`;
    case 6:
      return `{#key c}${inner()}{/key}`;
    case 7:
      return `{#await p}${inner()}{:then v}${inner()}{/await}`;
    case 8:
      return `{#snippet ${pick(rng, SNIPPETS)}()}${inner()}{/snippet}`;
    case 9:
      if (slots) return `<slot${attributes(rng)} />`;
      return `{@render ${pick(rng, [...SNIPPETS, "prop", "s1?.", "obj.s"])}()}`;
    case 10:
      return `<Child${chance(rng, 0.3) ? ` snippet={${pick(rng, [...SNIPPETS, "prop"])}}` : ""}${chance(rng, 0.2) ? " {...rest}" : ""}>${inner()}</Child>`;
    case 11:
      return `<svelte:element this={tag}${attributes(rng)}>${inner()}</svelte:element>`;
    case 12:
      return `<select${attributes(rng)}>${fragment(rng, depth + 1, true)}</select>`;
    case 13:
      return `<details${attributes(rng)}>${inner()}</details>`;
    case 14:
      return "text ";
    case 15:
      return `<Child>{#snippet ${pick(rng, SNIPPETS)}()}${inner()}{/snippet}</Child>`;
    case 16:
      return `<Child><div slot="a"${attributes(rng)}>${inner()}</div>${inner()}</Child>`;
    default:
      return `<p${attributes(rng)}>text</p>`;
  }
}

function compound(rng: Rng, nested: boolean, depth: number): string {
  const parts: string[] = [];
  const n = 1 + int(rng, 2);
  for (let i = 0; i < n; i++) {
    switch (int(rng, depth > 1 ? 9 : 16)) {
      case 0:
      case 1:
        if (i === 0)
          parts.push(
            pick(rng, [
              ...TAGS,
              "*",
              "option",
              "select",
              "selectedcontent",
              "details",
            ]),
          );
        else parts.push(`.${pick(rng, CLASSES)}`);
        break;
      case 2:
      case 3:
        parts.push(`.${pick(rng, CLASSES)}`);
        break;
      case 4:
        parts.push(`#${pick(rng, CLASSES)}`);
        break;
      case 5:
        parts.push(
          pick(rng, [
            "[data-k]",
            "[data-k=v]",
            "[data-k='V' i]",
            "[data-k~=w]",
            "[type=text]",
            "[type=text s]",
            "[open]",
          ]),
        );
        break;
      case 6:
        parts.push(
          pick(rng, [":hover", "::before", ":first-child", ":nth-child(2n+1)"]),
        );
        break;
      case 7:
        if (nested) parts.push("&");
        else parts.push(":root");
        break;
      case 8:
        parts.push(depth === 0 ? pick(rng, [":global", ":host"]) : ":host");
        break;
      case 9:
        if (depth === 0) parts.push(`:global(${complex(rng, nested, 1)})`);
        else parts.push(`.${pick(rng, CLASSES)}`);
        break;
      case 10:
      case 11:
        parts.push(
          `:${pick(rng, ["is", "where", "not", "has"])}(${list(rng, nested, depth + 1)})`,
        );
        break;
      default:
        parts.push(`.${pick(rng, CLASSES)}`);
    }
  }
  return parts.join("");
}

function complex(rng: Rng, nested: boolean, depth: number): string {
  const n = 1 + int(rng, 3);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    if (i > 0) out.push(pick(rng, [" ", " > ", " + ", " ~ "]));
    else if (depth > 0 && chance(rng, 0.15))
      out.push(pick(rng, ["> ", "+ ", "~ "]));
    out.push(compound(rng, nested, depth));
  }
  return out.join("");
}

function list(rng: Rng, nested: boolean, depth: number): string {
  const n = 1 + int(rng, 2);
  return Array.from({ length: n }, () => complex(rng, nested, depth)).join(
    ", ",
  );
}

function rules(rng: Rng, depth: number): string {
  const n = 1 + int(rng, 3);
  let out = "";
  for (let i = 0; i < n; i++) {
    const nested = depth > 0;
    switch (int(rng, 8)) {
      case 0:
        if (depth < 2)
          out += `@media (min-width: 1px) { ${rules(rng, depth)} }\n`;
        break;
      case 1:
        if (depth < 2)
          out += `${list(rng, nested, 0)} { color: red; ${rules(rng, depth + 1)} }\n`;
        break;
      case 2:
        if (depth === 0)
          out += "@keyframes k { from { color: red } 50% { color: blue } }\n";
        break;
      case 3:
        if (depth < 2)
          out += `:global { ${list(rng, false, 0)} { color: red } }\n`;
        break;
      default:
        out += `${list(rng, nested, 0)} { color: red }\n`;
    }
  }
  return out;
}

function component(rng: Rng): string {
  const runes = chance(rng, 0.5);
  slots = !runes && chance(rng, 0.5);
  const script = runes
    ? "<script>\n  let { prop, rest, ...others } = $props();\n  let c = $state(false);\n  let items = [], p, tag = 'div', obj = {};\n  import Child from './Child.svelte';\n</script>\n"
    : "<script>\n  export let prop; export let rest;\n  let c = false, items = [], p, tag = 'div', obj = {};\n  import Child from './Child.svelte';\n</script>\n";
  return `${script}${fragment(rng, 0)}\n<style>\n${rules(rng, 0)}</style>\n`;
}

const key = (w: {
  code: string;
  start: number;
  end: number;
  message: string;
}) => `${w.start}-${w.end} ${w.code}: ${w.message.split("\n")[0]}`;

let compared = 0;
let warnings = 0;
let failures = 0;
const start = performance.now();
for (let i = 0; i < iterations; i++) {
  const next = mulberry32(seed + i);
  const rng: Rng = () => next() / 2 ** 32;
  const source = component(rng);
  const expected = attempt(() =>
    compile(source, { generate: false })
      .warnings.filter((w) => w.code === "css_unused_selector")
      .map((w) =>
        key({
          code: w.code,
          message: w.message,
          start: w.start?.character ?? 0,
          end: w.end?.character ?? 0,
        }),
      )
      .sort((a, b) => a.localeCompare(b)),
  );
  if (!expected) continue;
  compared++;
  warnings += expected.length;
  let actual: string[];
  try {
    actual = compilerWarnings(parse(source), { runes: isRunesMode(source) })
      .map(key)
      .sort((a, b) => a.localeCompare(b));
  } catch (error) {
    actual = [`throws ${errorMessage(error)}`];
  }
  if (expected.join("\n") !== actual.join("\n")) {
    failures++;
    if (findingsDir) {
      mkdirSync(findingsDir, { recursive: true });
      writeFileSync(join(findingsDir, `${seed + i}.svelte`), source);
    }
    if (failures <= 3) {
      console.log(`--- seed ${seed + i}\n${source}`);
      for (const w of expected.filter((e) => !actual.includes(e)))
        console.log(`  missing ${w}`);
      for (const w of actual.filter((a) => !expected.includes(a)))
        console.log(`  extra   ${w}`);
    }
  }
}
console.log(
  `seed ${seed}: ${compared - failures} of ${compared} compiled components match (${warnings} warnings, ${iterations - compared} don't compile) in ${((performance.now() - start) / 1000).toFixed(1)}s`,
);
if (failures > 0) process.exit(1);
