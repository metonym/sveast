import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isRunesMode } from "sveast";
import { compile } from "svelte/compiler";
import { byCodeUnit } from "../scripts/shared";

const CORPUS = join(import.meta.dir, "corpus");

/** `compile`'s `metadata.runes`, with `await` allowed, or `undefined` if it throws. */
function svelteRunes(source: string): boolean | undefined {
  try {
    return compile(source, {
      generate: false,
      experimental: { async: true },
    }).metadata.runes;
  } catch {
    return undefined;
  }
}

test("matches svelte's compile on the corpus", () => {
  const paths = readdirSync(CORPUS, { recursive: true, encoding: "utf8" })
    .filter((path) => path.endsWith(".svelte"))
    .sort(byCodeUnit);
  let compared = 0;
  let runes = 0;
  for (const path of paths) {
    const source = readFileSync(join(CORPUS, path), "utf8");
    const expected = svelteRunes(source);
    if (expected === undefined) continue;
    compared++;
    if (expected) runes++;
    expect([path, isRunesMode(source)]).toEqual([path, expected]);
  }
  expect(compared).toBeGreaterThan(300);
  expect(runes).toBeGreaterThan(5);
});

const CASES: Record<string, string> = {
  "no runes": "<script>let a = 1;</script>{a}",
  "a rune call": "<script>let a = $state(0);</script>{a}",
  "a rune with type arguments":
    '<script lang="ts">let a = $state<number>(0);</script>{a}',
  "a rune member": "<script>let a = $state.raw([]);</script>{a}",
  "a rune in the module script":
    "<script module>export const a = $state({});</script>",
  "a rune in the markup": "<script>let a = 1;</script>{$state.snapshot(a)}",
  "a rune in a string": "<script>let a = '$state(0)';</script>",
  "a rune in a comment": "<script>// $state(0)\nlet a;</script>",
  "a rune as a property": "<script>let a = b.$state(0);</script>",
  "a rune as an object key": "<script>let a = { $state: 1 };</script>",
  "a rune as a method": "<script>let a = { $state() { return 1; } };</script>",
  "a rune name as a parameter":
    "<script>function f($state) { return $state(1); }</script>",
  "a rune name declared in a function":
    "<script>function f() { const $state = (x) => x; return $state(1); }</script>",
  "a rune name in a snippet's parameters":
    "{#snippet s($state)}{$state()}{/snippet}",
  "a type import of a rune name":
    '<script lang="ts">import type { $props } from "./x"; let a: $props;</script>',
  "a store named like a rune":
    '<script>import { writable } from "svelte/store"; const state = writable(0);</script>{$state}',
  "a store named like a rune, called":
    '<script>import { state } from "./stores"; $state;</script>',
  "a rune with a variable named like its store":
    "<script>let state = $state(0);</script>{state}",
  "props destructured into a store name":
    "<script>let { state } = $props();</script>{$state}",
  "derived from svelte/store":
    '<script>import { derived } from "svelte/store"; const d = $derived(1);</script>{d}',
  "a variable assigned in $:": "<script>$: state = 1; $state;</script>",
  "await at the top level": "<script>const a = await fetch('/');</script>",
  "await in a function": "<script>async function f() { await g(); }</script>",
  "await in the markup": "{await Promise.resolve(1)}",
  "await in the module script":
    "<script module>const a = await Promise.resolve(1);</script>",
  "export let": "<script>export let a;</script>{a}",
  "runes option": "<svelte:options runes />",
  "runes option false":
    "<svelte:options runes={false} /><script>let a = $state(0);</script>",
  "an escaped rune name": "<script>let a = \\u0024state(0);</script>",
  "a use directive named like a rune": "<div use:$effect></div>",
};

describe("matches svelte's compile", () => {
  for (const [name, source] of Object.entries(CASES)) {
    test(name, () => {
      const expected = svelteRunes(source);
      expect(typeof expected).toBe("boolean");
      expect(isRunesMode(source)).toBe(expected as boolean);
    });
  }
});

test("reads <svelte:options runes> without parsing the rest", () => {
  expect(isRunesMode("<svelte:options runes />{#if}")).toBe(true);
  expect(isRunesMode("<svelte:options runes={false} />{#if}")).toBe(false);
});

test("doesn't parse a component without a rune's name or await", () => {
  expect(isRunesMode("<script>let a = 1;</script>{#if}")).toBe(false);
});
