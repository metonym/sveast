import { join } from "node:path";
import { isRunesMode, parse } from "sveast";
import { compilerWarnings } from "sveast/warnings";
import { compile } from "svelte/compiler";
import {
  attempt,
  resetSvelteBidi,
  SVELTE_FILES,
  WARNING_CODES,
} from "../scripts/shared";
import { REPLACEMENTS, SVELTE_CODES } from "../src/warning-codes";
import { corpusFiles, readCorpus } from "./shared";

const key = (w: {
  code: string;
  message: string;
  start?: number;
  end?: number;
}) => `${w.start}-${w.end} ${w.code}: ${w.message}`;

interface Options {
  filename?: string;
  customElement?: boolean;
}

const svelteWarnings = (source: string, options: Options = {}) =>
  attempt(() => {
    resetSvelteBidi();
    return compile(source, {
      generate: false,
      experimental: { async: true },
      ...options,
    })
      .warnings.filter((w) => WARNING_CODES.has(w.code))
      .map((w) =>
        key({ ...w, start: w.start?.character, end: w.end?.character }),
      )
      .sort((a, b) => a.localeCompare(b));
  });

const sveastWarnings = (source: string, options: Options = {}) =>
  compilerWarnings(parse(source), {
    source,
    runes: isRunesMode(source),
    ...options,
  })
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

const RUNES = "<script>let r = $state(0);</script>";
const RUNES_CHILD =
  "<script>import Child from './Child.svelte'; let r = $state(0);</script>";

const TEMPLATE_CASES: Record<string, string> = {
  "empty blocks":
    "{#if a} {:else if b}\n{:else}\t{/if}{#each xs as x} {:else} {/each}{#await p} {:then} {:catch} {/await}{#key k} {/key}{#snippet s()} {/snippet}",
  "blocks with content or an empty fragment aren't empty":
    "{#if a}{/if}{#if a}<p></p>{/if}{#if a} x {/if}{#each xs as x}{/each}{#key k}<!-- c -->{/key}",
  "a svelte-ignore comment on a block":
    "<!-- svelte-ignore block_empty -->\n{#if a} {/if}{#if b} {/if}",
  "attribute names":
    "<div is='x' className='a' htmlFor='b' foo:bar='c' xmlns:x='d' xlink:href='e' xml:lang='f'></div><svelte:element this={t} is='x' className='a' a:b='c'></svelte:element>",
  "a colon on a component, not is or className": `${CHILD}<Child is='x' className='a' foo:bar='c' />`,
  "a svelte-ignore comment on an element covers its attributes":
    "<!-- svelte-ignore attribute_avoid_is -->\n<div is='x'></div><div is='y'></div>",
  "global event references": `<script>let onkeydown = () => {};</script><button onclick={onclick}></button><button {onclick}></button><button {onkeydown}></button><button onclick="{onclick}"></button><button on={on}></button><svelte:window {onresize} /><svelte:document {onvisibilitychange} /><svelte:body {onmouseenter} /><svelte:element this={t} {onclick}></svelte:element>`,
  "a global event reference a let: directive declares": `${CHILD}<Child><button slot="a" let:onclick {onclick}></button></Child>`,
  "a global event reference with a type-only import":
    "<script lang='ts'>import type { onclick } from './t';</script><button {onclick}></button>",
  "a lowercase component name":
    "<script>import foo from './Foo.svelte'; import bar from './Bar.svelte'; import baz from './Baz.svelte';</script><foo></foo><bar></bar>{bar}<baz/>",
  "a lowercase component name with a type-only import":
    "<script lang='ts'>import type foo from './Foo.svelte'; import { type bar } from './Bar.svelte';</script><foo></foo><bar></bar>",
  "a lowercase component name a let: directive shadows": `<script>import div from './Div.svelte';import Child from './Child.svelte';</script><Child let:div><div></div></Child><div></div>`,
  "a lowercase component name used as a store":
    "<script>import foo from './store';</script><foo></foo>{$foo}",
  "self-closing tags":
    "<div/><span /><br/><input/><svg><path/><circle /></svg><math><mi/></math><my-el/><svelte:element this={t}/><div></div><textarea/><custom:div/>",
  "bind on a rest in an each": `${RUNES}{#each xs as { a, ...rest }}<input bind:value={rest.b} /><input bind:value={a.b} />{/each}{#each xs as [x, ...ys]}<input bind:value={ys[0]} />{/each}{#each xs as { a: { ...deep } }}<input bind:value={deep.c} />{/each}`,
  "bind on a rest in an each, legacy and on a component": `${CHILD}{#each xs as { ...rest }}<Child bind:value={rest.b} /><input bind:value={rest} />{/each}`,
  "bind on a rest in an each, ignored on the element":
    "{#each xs as { ...rest }}<!-- svelte-ignore bind_invalid_each_rest -->\n<input bind:value={rest.b} /><input bind:value={rest.b} />{/each}",
  "bind on a rest in an each, with a sequence and a shadow":
    "{#each xs as { ...rest }}<input bind:value={() => rest.b, (v) => {}} />{#each ys as rest}<input bind:value={rest.b} />{/each}{/each}",
  "quoted attributes in runes mode": `${RUNES_CHILD}<Child a="{r}" b={r} c="x{r}" /><my-el a="{r}"></my-el><div is="x" a="{r}"></div><div a="{r}"></div><svelte:component this={Child} a="{r}" />`,
  "quoted attributes in legacy mode": `${CHILD}<Child a="{x}" /><my-el a="{x}"></my-el>`,
  "deprecations in runes mode": `${RUNES_CHILD}<button on:click={() => {}}></button><Child on:click={() => {}} /><svelte:window on:resize={() => {}} /><svelte:element this={t} on:click={() => {}}></svelte:element><slot></slot><svelte:component this={Child} />{#if a}<svelte:self />{/if}`,
  "deprecations in legacy mode": `${CHILD}<button on:click={() => {}}></button><slot></slot><svelte:component this={Child} />{#if a}<svelte:self />{/if}`,
  "no slot_element_deprecated in a custom element": `<svelte:options customElement="my-el" />${RUNES}<slot></slot>`,
  "no slot_element_deprecated in a custom element with an empty object": `<svelte:options customElement={{}} />${RUNES}<slot></slot>`,
  "a svelte-ignore comment before a component's child carries on in the default slot": `${CHILD}<Child><!-- svelte-ignore block_empty -->\n{#if a} {/if}<p></p>{#if b} {/if}<div slot="x">{#if c} {/if}</div>{#if d} {/if}</Child>`,
  "a svelte-ignore comment before a component's child carries on with no named slot": `${CHILD}<Child><!-- svelte-ignore block_empty -->\n{#if a} {/if}<p></p>{#if b} {/if}</Child>`,
  "a svelte-ignore comment before a named slot": `${CHILD}<Child><!-- svelte-ignore element_invalid_self_closing_tag -->\n<div slot="x"><span/></div><b/></Child>`,
  "a svelte-ignore comment with the legacy code in runes mode": `${RUNES}<!-- svelte-ignore block-empty -->\n{#if a} {/if}`,
  "a svelte-ignore comment with the legacy code in legacy mode":
    "<!-- svelte-ignore block-empty -->\n{#if a} {/if}",
  "template and CSS warnings together":
    "<div/>{#if a} {/if}<style>p {}</style>",
};

// Warnings svelte gives as it parses, for the scripts and for <svelte:options>.
const COMPONENT_CASES: Record<string, string> = {
  "implicitly closed by a sibling":
    "<ul><li>a<li>b</li></ul><p>x<div></div><dl><dt>a<dd>b</dd></dl>",
  "implicitly closed by a parent's closing tag":
    "<ul><li>a</ul><div><p>x</div><table><tbody><tr><td>a</tr></tbody></table><div><p><span>a</div>",
  "implicitly closed, empty element": "<ul><li><li></li></ul><div><p></div>",
  "implicitly closed twice":
    "<ul><li>a<li>b</ul><select><option>a<option>b</select>",
  "implicitly closed in a block":
    "{#if a}<ul><li>a<li>b</li></ul>{/if}{#each xs as x}<p>x<div></div>{/each}",
  "implicitly closed then closed by name": "<div><p>a<p>b</p></div>",
  "svelte:element this":
    '<svelte:element this=\'div\'></svelte:element><svelte:element this="h{n}"></svelte:element><svelte:element this={t}></svelte:element><svelte:element this="{t}"></svelte:element><svelte:element this=span />',
  "script attributes":
    "<script context='module' foo bar='x'></script><script lang='ts' generics='T' baz></script><p></p>",
  "script module attribute":
    "<script module type='x'></script><script>let a = $state(0);</script>",
  "script context in runes mode":
    '<script context="module">export const x = 1;</script><script>let a = $state(0);</script>',
  "options in runes mode": `<svelte:options accessors immutable customElement="my-el" />${RUNES}`,
  "options in legacy mode":
    '<svelte:options accessors immutable={true} customElement="my-el" />',
  "options with ignore": `<!-- svelte-ignore options_deprecated_accessors -->\n<svelte:options accessors />${RUNES}`,
  "placement in blocks":
    "<p>{#if a}<div></div>{/if}</p><table>{#each xs as x}<tr></tr>{/each}</table><ul>{#key k}<li><div><li></li></div></li>{/key}</ul><p>{#if a}<b><div></div></b>{/if}</p>",
  "placement through ancestors":
    "<p><span>{#if a}<div></div>{/if}</span></p><form><div>{#await x}<form></form>{/await}</div></form><a><b>{#if a}<a></a>{/if}</b></a>",
  "placement reset by dl": "<dd><dl>{#if a}<dt></dt>{/if}</dl></dd>",
  "placement through a component":
    "<script>import C from './C.svelte';</script><p>{#if a}<C><div></div></C>{/if}</p><p><C>{#if a}<div></div>{/if}</C></p>",
  "placement ignored":
    "<p>{#if a}<!-- svelte-ignore node_invalid_placement_ssr -->\n<div></div>{/if}</p>",
  "placement in snippet and svelte:element":
    "<p>{#if a}{#snippet s()}<div></div>{/snippet}{/if}</p><p><svelte:element this={t}>{#if a}<div></div>{/if}</svelte:element></p>",
  "placement custom element and template":
    "<p>{#if a}<my-el></my-el>{/if}</p><template>{#if a}<td></td>{/if}</template><div>{#if a}<td></td><tr></tr><tbody></tbody><col /><html></html>{/if}</div>",
  "placement with only rules":
    "<table>{#if a}<div></div><tbody></tbody>{/if}</table><tr>{#if a}<span></span>{/if}</tr><colgroup>{#if a}<col/><div></div>{/if}</colgroup>",
};

// Bidirectional control characters, built so this file has none.
const RLO = String.fromCharCode(0x202e);
const LRI = String.fromCharCode(0x2066);
const BACKSLASH = "\\";

const JS_CASES: Record<string, string> = {
  "bidi in strings, templates and text": `<script>let a = "${RLO}x"; let b = \`${RLO}\${a}${LRI}\`;</script><p title="${RLO}t">a${RLO}b${LRI}c</p>{"${RLO}"}`,
  "bidi as escapes and character references": `<script>let a = "${BACKSLASH}u202e"; let b = "${BACKSLASH}u{2066}";</script><p>&#x202e; &#8238;</p>`,
  "bidi in a textarea": `<textarea>\n${RLO}a{b}${RLO}</textarea><textarea>\n${RLO}</textarea>`,
  "bidi in an import isn't checked": `<script>import a from "./${RLO}.js";</script>`,
  "bidi after an ignore comment": `<!-- svelte-ignore bidirectional_control_characters -->\n<p>${RLO}</p><!-- svelte-ignore bidirectional_control_characters -->\na${RLO}<script>// svelte-ignore bidirectional_control_characters\nlet a = "${RLO}";</script>`,
  "the shared regex skips the string after a match": `<script>let a = "${RLO}${RLO}x"; let b = "${RLO}"; let c = "${RLO}";</script>`,
  "classes in the module script":
    "<script module>class A {} new class {}; const f = () => new class {}; function g() { class B {} new class {}; } const h = (x = new class {}) => x;</script>",
  "classes in the instance script":
    "<script>class A { m() { class B {} } } new class {}; { class C {} } $: { class D {} new class {}; }</script>",
  "classes in the markup":
    "{new class {}}{#if a}{(() => { class A {} })()}{/if}",
  "a TypeScript class with comments": `<script lang="ts">// svelte-ignore perf_avoid_inline_class\nconst a = new class {} as any; export {}; type T = string;</script>`,
  "legacy and unknown codes in runes mode": `${RUNES}<!-- svelte-ignore a11y-autofocus, nope, a11y_autofocus -->\n<p></p><!-- svelte-ignore empty-block x -->\n{#if a}{/if}`,
  "legacy and unknown codes in a script":
    "<script>// svelte-ignore perf-avoid-inline-class, state_referencd_locally\nlet a = $state(new class {});\n/* svelte-ignore unused-export-let */ let b = 1;</script>",
  "an ignore of unknown_code covers the codes inside": `${RUNES}<!-- svelte-ignore unknown_code -->\n<div><!-- svelte-ignore nope -->\n<p></p></div>`,
  "legacy and unknown codes before a style": `${RUNES}<!-- svelte-ignore nope, css-unused-selector -->\n<style>p {}</style>`,
  "legacy and unknown codes in legacy mode":
    "<!-- svelte-ignore nope, a11y-autofocus -->\n<p></p>",
  "a component's default slot reads a comment once per child": `<script>import Child from './Child.svelte'; let a = $state(0);</script><Child><!-- svelte-ignore nope -->\n<p></p><b></b><div slot="x"></div><i></i></Child>`,
};

let jsWarned = 0;
for (const [name, source] of Object.entries(JS_CASES)) {
  test(name, () => {
    const expected = svelteWarnings(source);
    expect(expected).toBeDefined();
    jsWarned += expected?.length ?? 0;
    expect(sveastWarnings(source)).toEqual(expected as string[]);
  });
}

test("the JavaScript cases warn", () => {
  expect(jsWarned).toBeGreaterThan(30);
});

test("no warning for a code svelte can't place, before a script", () => {
  // svelte throws "An impossible situation occurred" here.
  const source = `<!-- svelte-ignore nope -->\n${RUNES}`;
  expect(svelteWarnings(source)).toBeUndefined();
  expect(sveastWarnings(source)).toEqual([]);
});

for (const [name, source] of Object.entries(COMPONENT_CASES)) {
  test(name, () => {
    const expected = svelteWarnings(source);
    expect(expected).toBeDefined();
    expect(sveastWarnings(source)).toEqual(expected as string[]);
  });
}

const SCOPE_CASES: Record<string, string> = {
  "state_referenced_locally on state, derived and props": `<script>
	let count = $state(0); count = 1;
	let raw = $state.raw([]);
	let doubled = $derived(count * 2);
	let { size = 'md', ...rest } = $props();
	console.log(count, raw, doubled, size, rest);
	let tripled = $state(count * 3);
	let copy = $state(size);
	const read = () => count;
</script>`,
  "state_referenced_locally skips proxied state, writes and fallbacks": `<script>
	let obj = $state({ a: 1 });
	let list = $state([]);
	let { a, b = a } = $props();
	let other = $derived(a);
	console.log(obj, list);
	obj.a++;
	a = 2;
</script>`,
  "state_referenced_locally with export, casts and $inspect": `<script lang="ts">
	let count = $state(0);
	let el = $state() as HTMLElement;
	console.log(count, el, (count as number) + 1);
	$inspect(count);
	export { count };
</script>`,
  "state_referenced_locally in a {let} tag": `${RUNES}{let b = $state(1)}{let c = b}<div>{let d = b}</div>{#if r}{let e = $state(2)}{let f = e}{e}{/if}`,
  "state_referenced_locally ignored": `<script>
	let count = $state(0); count = 1;
	// svelte-ignore state_referenced_locally
	console.log(count);
	console.log(count);
</script>`,
  "non_reactive_update in the markup": `<script>
	let a = 1; let b = 2; let c = 3; let d; let e; let f = 4;
	let s = $state(0);
	function set() { a = 5; b = 6; c = 7; d = 8; f = 9; }
</script>
<p>{a}</p><button onclick={() => b}>x</button>
<input bind:value={c} /><div bind:this={d}></div>{#if a}<div bind:this={e}></div>{/if}
<p style:color={f}></p>`,
  "non_reactive_update from the module script, var twice, and ignored": `<script module>
	let m = 1;
	export function bump() { m++; }
</script>
<script>
	var v = 1; var v = 2;
	// svelte-ignore non_reactive_update
	let quiet = 1;
	const later = () => { v = 3; quiet = 4; };
	import Imported from './Child.svelte';
	let { p } = $props();
	let s = $state(0);
	s = 1;
</script>
{m}{v}{quiet}{s}<Imported />`,
  "export_let_unused in legacy mode": `<script>
	export let used;
	export let unused;
	export let a, b = 1;
	export var c;
	let d; let e;
	export { d, e as f };
	export const g = 1;
	let store;
	export let sub;
	// svelte-ignore export_let_unused
	export let quiet;
</script>
{used}{a}{$sub}`,
  "export_let_unused skips $props() in legacy mode":
    "<script>let { a } = $props(); export { a };</script>",
  "store_rune_conflict, which svelte-ignore can't silence": `<script>
	import { state } from './stores';
	let derived = 1;
	// svelte-ignore store_rune_conflict
	const a = $state(0);
	const b = $derived(1);
	const c = foo($state);
</script>`,
  "store_rune_conflict on a prop named like a rune":
    "<script>let { state } = $props(); const a = $state(0);</script>",
  reactive_declaration_invalid_placement: `<script context="module">
	$: a = 1;
</script>
<script>
	export let x;
	function f() { $: b = 2; }
	$: if (x) { const g = () => { $: c = 3; }; }
	// svelte-ignore reactive_declaration_invalid_placement
	{ $: d = 4; }
</script>
<button on:click={() => { $: e = 5; }}>x</button>`,
  reactive_declaration_module_script_dependency: `<script context="module">
	let count = 0;
	let fixed = 0;
	export function inc() { count += 1; }
</script>
<script>
	$: doubled = count * 2;
	$: same = fixed * 2;
	$: { const f = () => count; }
	// svelte-ignore reactive_declaration_module_script_dependency
	$: quiet = count;
	console.log(count);
</script>`,
  custom_element_props_identifier: `<svelte:options customElement="x-a" />
<script>
	let props = $props();
</script>`,
  "custom_element_props_identifier on a rest element": `<svelte:options customElement="x-a" />
<script>
	let { a, ...rest } = $props();
</script>`,
  "custom_element_props_identifier with customElement.props": `<svelte:options customElement={{ tag: "x-a", props: { a: {} } }} />
<script>
	let props = $props();
</script>`,
  legacy_component_creation: `<script lang="ts">
	import App, { Named } from './App.svelte';
	import Other from './other.js';
	new App({ target: document.body });
	new App({ target: null } as any);
	new App({});
	new Named({ target: document.body });
	new Other({ target: document.body });
	// svelte-ignore legacy_component_creation
	new App({ target: document.body });
	const app = new App({ target: document.body });
</script>`,
};

let scopeWarned = 0;
for (const [name, source] of Object.entries(SCOPE_CASES)) {
  test(name, () => {
    const expected = svelteWarnings(source);
    expect(expected).toBeDefined();
    scopeWarned += expected?.length ?? 0;
    expect(sveastWarnings(source)).toEqual(expected as string[]);
  });
}

test("the scope cases warn", () => {
  expect(scopeWarned).toBeGreaterThan(30);
});

test("custom_element_props_identifier with the customElement option", () => {
  const source = "<script>let props = $props();</script>";
  const options = { customElement: true };
  const expected = svelteWarnings(source, options);
  expect(expected).toHaveLength(1);
  expect(sveastWarnings(source, options)).toEqual(expected as string[]);
});

test("options_missing_custom_element with the customElement option", () => {
  const source = '<svelte:options customElement="my-el" />';
  const options = { customElement: true };
  expect(sveastWarnings(source, options)).toEqual(
    svelteWarnings(source, options) as string[],
  );
  expect(sveastWarnings(source, options)).toHaveLength(0);
});

test("parse warnings stay with the AST parse returned", () => {
  const source = "<ul><li>a<li>b</li></ul>";
  const ast = parse(source);
  expect(compilerWarnings(ast, { source })).toHaveLength(1);
  expect(compilerWarnings(structuredClone(ast), { source })).toHaveLength(0);
});

for (const [name, source] of Object.entries(TEMPLATE_CASES)) {
  test(name, () => {
    const expected = svelteWarnings(source);
    expect(expected).toBeDefined();
    expect(sveastWarnings(source)).toEqual(expected as string[]);
  });
}

const SELF = `${RUNES}{#if a}<svelte:self />{/if}`;

const SELF_CASES: [string, string, Options][] = [
  ["no filename", SELF, {}],
  ["a file name", SELF, { filename: "src/lib/Button.svelte" }],
  ["a lowercase file name", SELF, { filename: "tree-view.svelte" }],
  ["an index file", SELF, { filename: "lib/tree/index.svelte" }],
  ["an index file in src", SELF, { filename: "src/index.svelte" }],
  ["a Windows path", SELF, { filename: "C:\\app\\9lives.svelte" }],
  [
    "a name that clashes with a declaration",
    "<script>let Button = $state(0); let Button_1 = 1;</script>{#if a}<svelte:self />{/if}",
    { filename: "Button.svelte" },
  ],
  [
    "a name that clashes with a global and a template name",
    `${RUNES}{Tree}{#each xs as Tree_1}{/each}{#snippet Tree_2()}{/snippet}{#if a}<svelte:self />{/if}`,
    { filename: "Tree.svelte" },
  ],
  ["a name svelte gives an each index", SELF, { filename: "$$index.svelte" }],
  [
    "a name svelte gives an each index, with each blocks",
    `${RUNES}{#each xs as x}{/each}{#each xs as x, i}{/each}{#if a}<svelte:self />{/if}`,
    { filename: "$$index.svelte" },
  ],
];

for (const [name, source, options] of SELF_CASES) {
  test(`svelte_self_deprecated: ${name}`, () => {
    const expected = svelteWarnings(source, options);
    expect(expected).toBeDefined();
    expect(sveastWarnings(source, options)).toEqual(expected as string[]);
  });
}

test("slot_element_deprecated with the customElement option", () => {
  const source = `${RUNES}<slot></slot>`;
  const options = { customElement: true };
  expect(sveastWarnings(source, options)).toEqual(
    svelteWarnings(source, options) as string[],
  );
  expect(sveastWarnings(source)).toHaveLength(1);
});

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

test("svelte knows every svelte-ignore code and renaming", () => {
  // scripts/generate-warning-codes.ts writes the lists. svelte gives
  // unknown_code for a code it doesn't know, and legacy_code with the
  // new name for a renamed one.
  const ignore = (codes: string[]) =>
    `${RUNES}<!-- svelte-ignore ${codes.join(", ")} -->\n<p></p>`;
  expect(svelteWarnings(ignore([...SVELTE_CODES]))).toEqual([]);
  for (const [from, to] of Object.entries(REPLACEMENTS)) {
    const [warning] = svelteWarnings(ignore([from])) ?? [];
    // svelte renames one code to a code it doesn't have.
    const expected = SVELTE_CODES.includes(to)
      ? `legacy_code: \`${from}\` is no longer valid — please use \`${to}\` instead`
      : `unknown_code: \`${from}\` is not a recognised code`;
    expect(warning).toContain(expected);
    expect(sveastWarnings(ignore([from]))).toEqual([warning]);
  }
});
