import type { ParseOptions } from "sveast";

export const flat = (source: string): string =>
  Buffer.from(source, "utf8").toString("utf8");

function repeatTo(bytes: number, unit: (i: number) => string): string {
  const parts: string[] = [];
  let length = 0;
  for (let i = 0; length < bytes; i++) {
    const part = unit(i);
    parts.push(part);
    length += part.length;
  }
  return parts.join("");
}

export interface Construct {
  name: string;
  build: (bytes: number) => string;
  options?: ParseOptions;
  deep?: boolean;
}

const TS = '<script lang="ts"></script>\n';

const CSS_UNIT = (i: number) => `/* card ${i} */
.card-${i} > .title:hover, :global(.dark) .card-${i} ~ p[data-state='open']::before {
  color: var(--text, #161616);
  margin: 0 auto !important;
  background: url("data:image/png;base64,iVBORw0KGgo=") no-repeat;
}
@media (min-width: 42rem) and (prefers-reduced-motion: no-preference) {
  .card-${i} { padding: calc(1rem + 2px) 0.5rem; transition: opacity 150ms ease-in; }
}
.list-${i} { & li:nth-child(2n + 1) { font: 400 0.875rem/1.3 "IBM Plex Sans", sans-serif; } }
@keyframes spin-${i} { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
`;

const css = (bytes: number) =>
  `<p>{a}</p>\n<style>\n${repeatTo(bytes, CSS_UNIT)}</style>\n`;

export const CONSTRUCTS: Construct[] = [
  {
    name: "static markup, no expressions",
    build: (bytes) =>
      repeatTo(
        bytes,
        (i) =>
          `<section class="s${i}">\n  <h2>Heading ${i}</h2>\n  <p>Lorem ipsum dolor sit amet, <em>consectetur</em> adipiscing elit.</p>\n  <br />\n</section>\n`,
      ),
  },
  {
    name: "text with entities",
    build: (bytes) =>
      repeatTo(
        bytes,
        () =>
          "<p>Fish &amp; chips &lt;3 caf&eacute; &copy; 2024 &#169; &#x1F600; a&nbsp;b &hellip; &notanentity; {x}</p>\n",
      ),
  },
  {
    name: "static attributes",
    build: (bytes) =>
      repeatTo(
        bytes,
        (i) =>
          `<div id="item-${i}" class="card card--active" data-index="${i}" aria-label="Save &amp; close" title='Tip' tabindex=0 hidden>{x}</div>\n`,
      ),
  },
  {
    name: "expression attributes and directives",
    build: (bytes) =>
      repeatTo(
        bytes,
        () =>
          `<Button kind={kind} {size} label="Hello {name}!" on:click|preventDefault={submit} bind:value={value} class:active={isActive} style:color="red" use:tooltip={options} transition:fade|local {...rest} {@attach ref}>{x}</Button>\n`,
      ),
  },
  {
    name: "expression tags, fast path",
    build: (bytes) =>
      repeatTo(
        bytes,
        () =>
          `<p>{a} {b.c.d} {e[0]} {f["g"]} {!h} {!!i} {j === "k"} {l !== m} {n || o} {p ?? q} {42} {true} {null}</p>\n`,
      ),
  },
  {
    name: "expression tags, acorn",
    build: (bytes) =>
      repeatTo(
        bytes,
        () =>
          // the component holds a template literal; split so it isn't read as a placeholder
          "<p>{a(b)} {c ? d : e} {f.map((g) => g.h)} {`t-$" +
          "{i}`} {a + b * c} {x?.y} {(z)} {[1, 2]} {{ k: v }.k} {i++}</p>\n",
      ),
  },
  {
    name: "blocks",
    build: (bytes) =>
      repeatTo(
        bytes,
        () =>
          `{#if a}<p>a</p>{:else if b}<p>b</p>{:else}<p>c</p>{/if}
{#each items as item, i (item.id)}<li>{item.name}</li>{:else}<li>none</li>{/each}
{#await promise}<p>loading</p>{:then value}<p>{value}</p>{:catch error}<p>{error.message}</p>{/await}
{#key id}<div>{id}</div>{/key}
`,
      ),
  },
  {
    name: "nested {#if}",
    build: (bytes) => {
      const depth = Math.ceil(bytes / 14);
      return `${"{#if a}<b>".repeat(depth)}x${"</b>{/if}".repeat(depth)}`;
    },
    deep: true,
  },
  {
    name: "nested elements",
    build: (bytes) => {
      const depth = Math.ceil(bytes / 11);
      return `${"<div>".repeat(depth)}{x}${"</div>".repeat(depth)}`;
    },
    deep: true,
  },
  {
    name: "destructuring patterns",
    build: (bytes) =>
      repeatTo(
        bytes,
        () =>
          `{#each rows as { id, cells: [first, ...rest] }, i (id)}{@const { label, meta: [tag] } = first}<td>{label}</td>{/each}
{#await promise then { data, errors: [firstError] }}<p>{data}</p>{:catch { message }}<p>{message}</p>{/await}
`,
      ),
  },
  {
    name: "{#each} pattern with defaults",
    build: (bytes) =>
      repeatTo(
        bytes,
        () =>
          `{#each items as { id, label = "untitled", tags = [] }, i (id)}<li>{label}</li>{/each}\n`,
      ),
  },
  {
    name: "typed patterns, TypeScript",
    build: (bytes) =>
      TS +
      repeatTo(
        bytes,
        () =>
          "{#each rows as { id, label }: Row (id)}{@const total: number = sum(id)}<p>{label}</p>{/each}\n",
      ),
  },
  {
    name: "snippets and render tags",
    build: (bytes) =>
      repeatTo(
        bytes,
        (i) =>
          `{#snippet row${i}(item, index = 0, { selected } = {})}<td class:selected>{item.name}</td>{/snippet}\n{@render row${i}(items[${i}], ${i})}\n`,
      ),
  },
  {
    name: "snippets, TypeScript",
    build: (bytes) =>
      TS +
      repeatTo(
        bytes,
        (i) =>
          `{#snippet row${i}<T extends { id: string }>(item: T, index?: number)}<td>{item.id}</td>{/snippet}\n{@render row${i}(items[${i}] as Item, ${i})}\n`,
      ),
  },
  {
    name: "special tags",
    build: (bytes) =>
      repeatTo(
        bytes,
        () =>
          "{#if show}{@const doubled = count * 2}{@html marked(body)}{@debug doubled, count}{@render children?.()}{/if}\n",
      ),
  },
  {
    name: "comments in template",
    build: (bytes) =>
      repeatTo(
        bytes,
        () =>
          `<!-- a comment -->\n<div // line comment\n  a="1" /* block */ b={c}>{d /* trailing */} {e // line\n}</div>\n`,
      ),
  },
  {
    name: "svelte: elements",
    build: (bytes) =>
      repeatTo(
        bytes,
        () =>
          `<svelte:element this={tag} class="x">{y}</svelte:element><svelte:boundary onerror={handle}><p>{z}</p></svelte:boundary><svelte:component this={C} {...props} />\n`,
      ),
  },
  {
    name: "<script>, JavaScript",
    build: (bytes) =>
      `<script>\n${repeatTo(
        bytes,
        (i) => `  export let prop${i} = undefined;
  let items${i} = [];
  $: selected${i} = items${i}.filter((item) => item.selected);
  function handle${i}(event) {
    const { target } = event;
    if (!target || target.disabled) return;
    items${i} = items${i}.map((item, index) => ({ ...item, selected: index === ${i} }));
    dispatch("change", { value: target.value, label: \`item-\${${i}}\` });
  }
`,
      )}</script>\n<p>{x}</p>\n`,
  },
  {
    name: "<script>, TypeScript",
    build: (bytes) =>
      `<script lang="ts">\n${repeatTo(
        bytes,
        (
          i,
        ) => `  interface Item${i} { id: string; label?: string; readonly children: Array<Item${i}> }
  type Handler${i}<T> = (value: T, index: number) => void;
  let { value${i} = $bindable(0), onchange${i} }: { value${i}?: number; onchange${i}?: Handler${i}<number> } = $props();
  function map${i}<T, U>(items: readonly T[], fn: (item: T) => U): U[] {
    return items.map(fn) as U[];
  }
  const config${i} = { size: "sm", count: 1 } satisfies Record<string, unknown>;
  let cache${i}: Map<string, Set<number>> = new Map();
`,
      )}</script>\n<p>{x}</p>\n`,
  },
  {
    name: "<script>, TypeScript ambiguities",
    build: (bytes) =>
      `<script lang="ts">\n${repeatTo(
        bytes,
        (i) => `  const call${i} = f<T>(x) + (a < b ? 1 : 0);
  const generic${i} = <T,>(y: T): T => y;
  const cond${i} = ok ? (a) : b;
  const arrow${i} = async (q: Q, r?: R): Promise<void> => { await q; };
  const cmp${i} = s < t && u > v;
  const cast${i} = (w as unknown as W<X>).z;
`,
      )}</script>\n<p>{x}</p>\n`,
  },
  {
    name: "<script>, comments",
    build: (bytes) =>
      `<script>\n${repeatTo(
        bytes,
        (i) => `  /**
   * Doc comment for fn${i}.
   * @param {string} a The value.
   */
  function fn${i}(a) {
    // leading comment
    return a; // trailing comment
  }
  /* block */ let v${i} = [1, /* inner */ 2]; // after
`,
      )}</script>\n<p>{x}</p>\n`,
  },
  { name: "<style>", build: css },
  { name: "<style>, css: false", build: css, options: { css: false } },
  {
    name: "expression tags, loc: true",
    build: (bytes) =>
      repeatTo(bytes, () => `<p>\n  {a} {b.c} {!d} {e === "f"}\n</p>\n`),
    options: { loc: true },
  },
  {
    name: "expression tags, acorn, loc: true",
    build: (bytes) =>
      repeatTo(
        bytes,
        () => "<p>\n  {a(b)} {c ? d : e} {f.map((g) => g.h)}\n</p>\n",
      ),
    options: { loc: true },
  },
  {
    name: "expression tags, CR line breaks, loc: true",
    build: (bytes) =>
      repeatTo(bytes, () => "<p>\r  {a(b)} {c ? d : e} {f}\r</p>\r"),
    options: { loc: true },
  },
  {
    name: "expression tags, acorn, one line",
    build: (bytes) => repeatTo(bytes, () => "<p>{a(b)} {c ? d : e} {f}</p>"),
  },
  {
    name: "<script>, TypeScript, loc: true",
    build: (bytes) =>
      `<script lang="ts">\n${repeatTo(
        bytes,
        (i) =>
          `  function map${i}<T, U>(items: readonly T[], fn: (item: T) => U): U[] {\n    return items.map(fn) as U[];\n  }\n`,
      )}</script>\n<p>{x}</p>\n`,
    options: { loc: true },
  },
];

export const SVELTE_OPTIONS_COMPONENTS: string[] = Array.from(
  { length: 100 },
  (_, i) =>
    flat(`<svelte:options runes customElement={{ tag: "x-el-${i}", shadow: "open", props: { label: { type: "String", reflect: true } } }} namespace="html" css="injected" />
<svelte:window on:resize={onResize} bind:innerWidth={width} />
<svelte:document on:visibilitychange={onVisibility} />
<svelte:body on:click={onClick} />
<svelte:head><title>{title} {${i}}</title><meta name="description" content={description} /></svelte:head>
<p>{label}</p>
`),
);

/** A barrel of re-exports with long PascalCase names, like Carbon's `src/index.js`. */
export const LONG_NAME_BARREL: string = flat(
  Array.from(
    { length: 500 },
    (_, i) =>
      `export { default as DataTableSkeletonRow${i} } from "./DataTable/DataTableSkeletonRow${i}.svelte";\n`,
  ).join(""),
);
