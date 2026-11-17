import { join } from "node:path";
import { isRunesMode, parse } from "sveast";
import { compilerWarnings } from "sveast/warnings";
import { compile } from "svelte/compiler";
import { attempt, SVELTE_FILES } from "../scripts/shared";
import { corpusFiles, readCorpus } from "./shared";

const CODES = new Set(["css_unused_selector"]);

const key = (w: {
  code: string;
  message: string;
  start?: number;
  end?: number;
}) => `${w.start}-${w.end} ${w.code}: ${w.message}`;

const svelteWarnings = (source: string) =>
  attempt(() =>
    compile(source, { generate: false, experimental: { async: true } })
      .warnings.filter((w) => CODES.has(w.code))
      .map((w) =>
        key({ ...w, start: w.start?.character, end: w.end?.character }),
      )
      .sort((a, b) => a.localeCompare(b)),
  );

const sveastWarnings = (source: string) =>
  compilerWarnings(parse(source), { runes: isRunesMode(source) })
    .map(key)
    .sort((a, b) => a.localeCompare(b));

test("matches svelte's compile on the corpus", () => {
  let compared = 0;
  let warned = 0;
  for (const path of corpusFiles(SVELTE_FILES)) {
    const source = readCorpus(path);
    const expected = svelteWarnings(source);
    if (expected === undefined || attempt(() => parse(source)) === undefined)
      continue;
    compared++;
    warned += expected.length;
    expect([path, sveastWarnings(source)]).toEqual([path, expected]);
  }
  expect(compared).toBeGreaterThan(350);
  expect(warned).toBeGreaterThan(15);
}, 30_000);

const CHILD = "<script>import Child from './Child.svelte';</script>";

const CASES: Record<string, string> = {
  "an unused class and type":
    "<p class='a'></p><style>.a {} .b {} div {}</style>",
  "a selector in a list": "<p></p><style>p, div, .x {}</style>",
  "descendant, child and sibling combinators":
    "<div><p></p></div><span></span><style>div p {} div > p {} p + span {} div ~ span {} span p {} p ~ div {}</style>",
  "siblings across if and each blocks":
    "{#if a}<p></p>{:else}<b></b>{/if}{#each xs as x}<i></i>{/each}<style>p + i {} b + i {} i + i {} p + b {}</style>",
  "class values from an expression, class: and clsx":
    '<p class={a ? "x" : "y"}></p><b class:z={a}></b><i class={[a && "u", { v: a }]}></i><style>.x {} .y {} .z {} .u {} .v {} .w {}</style>',
  "a class in a template string":
    '<p class="a-{b}"></p><style>.a-c {} .b-c {}</style>',
  "a spread can carry any class":
    "<p {...props}></p><style>.a {} div {}</style>",
  "attribute selectors":
    '<p data-k="v w" type="TEXT"></p><style>[data-k] {} [data-k~=w] {} [data-k=v] {} [type=text] {} [type=text s] {} [data-k="V W" i] {}</style>',
  ":global, :root and :host":
    "<p></p><style>:global(div) {} :global(div) p {} :global { .x {} } div :global(.y) {} :root {} :host p {}</style>",
  ":is, :where, :not and :has":
    "<div><p class='y'></p></div><style>:is(div, b) {} :where(.y) {} p:not(.x) {} div:has(p) {} div:has(b) {} :is(b, i) {}</style>",
  "every element is tried for :is, where a later one matches":
    "<b></b><p class='y'></p><style>:is(.y, :hover) {}</style>",
  "nesting and a parent rule":
    "<div><p></p></div><style>div { & p {} & b {} } b { & p {} }</style>",
  "keyframes and media":
    "<p></p><style>@keyframes k { from {} to {} } @media (min-width: 1px) { p {} b {} }</style>",
  "a svelte-ignore comment before the rule, in legacy mode":
    "<p></p><style>/* svelte-ignore css-unused-selector */ b {} i {}</style>",
  "a svelte-ignore comment before the rule, in runes mode":
    "<script>let a = $state(0);</script><p>{a}</p><style>/* svelte-ignore css_unused_selector */ b {} /* svelte-ignore css-unused-selector */ i {}</style>",
  "elements in snippets and render tags":
    "{#snippet s()}<b></b>{/snippet}<div>{@render s()}</div><p>{@render props.t()}</p><style>div b {} div > b {} p > i {}</style>",
  "a snippet passed to a component": `${CHILD}{#snippet s()}<b></b>{/snippet}<div><Child snippet={s} /></div><style>div b {} p b {}</style>`,
  "a slot child isn't a sibling of the others": `${CHILD}<Child><div slot="a"></div><a></a></Child><style>:has(~ a) {} div + a {} div ~ a {}</style>`,
  "a TypeScript cast in a class":
    "<script lang='ts'>let a = false;</script><p class={a as boolean ? 'x' : 'y'}></p><p class={'z' as string}></p><style>.x {} .y {} .z {} .w {}</style>",
  "select, option and selectedcontent":
    "<select><button><selectedcontent></selectedcontent></button><option><span class='x'></span></option></select><style>selectedcontent .x {} selectedcontent .y {} option span {}</style>",
  "svelte:element and svelte:head":
    "<svelte:head><title>t</title></svelte:head><svelte:element this={tag}></svelte:element><style>title {} div {} span {}</style>",
  "an element and its :has(), in a global selector":
    "<p class='x'><b></b></p><style>:root:has(.x) {} :global(.y):has(p > b) {} :global(.y):has(i) {} :root:has(> p) {}</style>",
  "more attribute operators":
    '<p lang="en-US" data-k="abc"></p><style>[lang|=en] {} [lang|=fr] {} [data-k^=a] {} [data-k$=c] {} [data-k*=b] {} [data-k^=c] {}</style>',
  "a class split around expressions":
    "<p class=\"a {b} c\"></p><i class=\"{d ? 'x ' : 'y'}z\"></i><b class=\"u{d ? ' v' : 'w'}\"></b><style>.a {} .c {} .xz {} .x {} .z {} .yz {} .u {} .v {} .uw {} .w {}</style>",
  "an attribute selector on a value split around expressions":
    "<p data-k=\"{d ? 'x ' : 'y'}z\"></p><i data-k=\"u{d ? ' v' : 'w'}\"></i><b data-k=\"a {d ? 'b' : 'c'} e\"></b><style>[data-k=xz] {} [data-k=yz] {} [data-k~=x] {} [data-k~=z] {} [data-k=uw] {} [data-k~=v] {} [data-k~=u] {} [data-k=\"a b e\"] {} [data-k~=e] {} [data-k=q] {}</style>",
  "a class from && and ||":
    '<p class={a && "x"}></p><i class={a || "y"}></i><b class={[a && "z"]}></b><style>.x {} .y {} .z {} [class=""] {}</style>',
  "a :has() into selectedcontent":
    "<select><button><selectedcontent></selectedcontent></button><option><span class='x'></span></option></select><style>selectedcontent:has(.x) {} selectedcontent:has(.y) {} selectedcontent:has(> span) {}</style>",
  "siblings across await, key and slot":
    "<p></p>{#await x}<i></i>{:then}<b></b>{:catch}<u></u>{/await}{#key k}<s></s>{/key}<slot><em></em></slot><a></a><style>p + i {} p + b {} p ~ u {} p ~ s {} p ~ em {} p ~ a {} a + p {} em + a {}</style>",
  "siblings through a render tag and a snippet":
    "{#snippet s()}<b></b>{/snippet}<p></p>{@render s()}<i></i><div>{#snippet t()}<u></u>{/snippet}{@render t()}</div><style>p + b {} b + i {} p ~ i {} i ~ b {} div > u {}</style>",
  "no style": "<p></p>",
};

for (const [name, source] of Object.entries(CASES)) {
  test(name, () => {
    const expected = svelteWarnings(source);
    expect(expected).toBeDefined();
    expect(sveastWarnings(source)).toEqual(expected as string[]);
  });
}

const ALL_MATCH = /: (\d+) of \1 compiled components match/;

test("has no false positives or misses on fuzzed components", async () => {
  const proc = Bun.spawn({
    cmd: ["bun", "scripts/fuzz-css.ts", "--iterations", "3000", "--seed", "1"],
    cwd: join(import.meta.dir, ".."),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, out] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
  ]);
  expect(out).toMatch(ALL_MATCH);
  expect(exitCode).toBe(0);
}, 30_000);
