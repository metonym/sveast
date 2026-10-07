import { svelteParity } from "./shared";

const PATTERNS = [
  "{ a }",
  "{ a = 1 }",
  "{ a: b }",
  "{ a: { b = [] } }",
  "{ a: [b, c = 'x'] }",
  "[a, , b]",
  "[a = 1, ...rest]",
  "{ a, ...rest }",
  "{ a: (b) }",
  "{ a = (1) }",
  "[(a)]",
  "[((a))]",
  "{ 'a-b': c, 1: d }",
  "{ [k]: v }",
  "{ a /* c */ }",
  "[a, /* c */ b]",
  "{ /* c */ }",
  "{ a, // c\n  b }",
  "{ a: b.c }",
  "[a.b, c[0]]",
  "{ a() {} }",
  "{ a: 1 }",
  "[1]",
  "{ a = 1, }",
  "[a,]",
  "[...a,]",
  "{ ...a, b }",
  "{ ...{ a } }",
  "[...[a]]",
  "{ eval }",
  "{ arguments: a }",
  "{ await }",
  "{ a: async }",
  "{ a = b = c }",
  "{ a = () => {} }",
  "{ a = { b } }",
  "{ a: { b } = {} }",
  "[{ a }, [b]]",
  "{ a, a }",
  "{ get a() {} }",
  "{ a: b = (c, d) }",
  "{ a: (b = 1) }",
  // biome-ignore lint/suspicious/noTemplateCurlyInString: a template literal in the pattern
  "[a = `x${y}`]",
  "{ \\u0061 }",
  "{ a: b?.c }",
  "{ a = '}' }",
  '{ a = "]" }',
  "{ a = /}/ }",
  "{ a /* } */ }",
  "{ a = (b) => ({ c }) }",
];

const COMPONENTS = [
  (p: string) => `{#each items as ${p}, i (i)}<p>{i}</p>{/each}`,
  (p: string) => `{#each items as ${p}}{:else}none{/each}`,
  (p: string) =>
    `{#await promise then ${p}}<p>x</p>{:catch ${p}}<p>y</p>{/await}`,
  (p: string) => `{#if x}{@const ${p} = value}<p>z</p>{/if}`,
];

describe("destructuring patterns match svelte/compiler", () => {
  for (const script of ["", '<script lang="ts"></script>\n']) {
    for (const pattern of PATTERNS) {
      test(`${script ? "TypeScript" : "JavaScript"}: ${pattern}`, () => {
        for (const component of COMPONENTS) {
          const { ours, theirs } = svelteParity(
            `${script}<p>before</p>\n${component(pattern)}\n<p>after</p>`,
          );
          expect(ours).toEqual(theirs);
        }
      });
    }
  }
});

const TYPES = [
  "T",
  "T[]",
  "Array<{ a: string; b: number }>",
  "{ a: string, b: number }",
  "{ a?: string }",
  "(a: T, b?: U) => V",
  "'x' | 'y'",
  "typeof items[number]",
  "[a: T, b?: U]",
  "T /* c */",
  "T // c\n",
  "Record<string, () => void>",
  "T extends U ? V : W",
  "T,",
  "T = ",
  "",
];

const TYPED = [
  (t: string) => `{#each items as item: ${t}, i (i)}<p>{i}</p>{/each}`,
  (t: string) => `{#each items as { id, label }: ${t} (id)}<p>{id}</p>{/each}`,
  (t: string) => `{#each items as item:${t}}{/each}`,
  (t: string) => `{#each items as item\n  : ${t}}{/each}`,
  (t: string) => `{#if x}{@const total: ${t} = sum(a, b)}<p>{total}</p>{/if}`,
  (t: string) => `{#if x}{@const { a, b = 1 }: ${t} = value}<p>{a}</p>{/if}`,
  (t: string) => `{#snippet row(item: ${t}, i: number)}<p>{i}</p>{/snippet}`,
  (t: string) => `{#snippet row(item: ${t} = x)}<p>{item}</p>{/snippet}`,
];

describe("type annotations match svelte/compiler", () => {
  for (const after of ["", "\n<p>Why?: {x}</p>"]) {
    for (const type of TYPES) {
      test(`${JSON.stringify(type)}${after ? ", a `?:` after" : ""}`, () => {
        for (const component of TYPED) {
          const { ours, theirs } = svelteParity(
            `<script lang="ts"></script>\n<p>before</p>\n${component(type)}${after}\n<p>after</p>`,
          );
          expect(ours).toEqual(theirs);
        }
      });
    }
  }
});
