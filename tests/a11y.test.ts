import { isRunesMode, parse } from "sveast";
import { a11yWarnings } from "sveast/a11y";
import { compile } from "svelte/compiler";
import { attempt, SVELTE_FILES } from "../scripts/shared";
import { corpusFiles, readCorpus } from "./shared";

const SVELTE_IGNORE = /<!--\s*svelte-ignore[\s\S]*?-->/g;

const key = (w: {
  code: string;
  message: string;
  start?: number;
  end?: number;
}) => `${w.start}-${w.end} ${w.code}: ${w.message}`;

const svelteWarnings = (source: string) =>
  attempt(() =>
    compile(source, { generate: false, experimental: { async: true } })
      .warnings.filter((w) => w.code.startsWith("a11y"))
      .map((w) =>
        key({ ...w, start: w.start?.character, end: w.end?.character }),
      )
      .sort((a, b) => a.localeCompare(b)),
  );

const sveastWarnings = (source: string) =>
  a11yWarnings(parse(source), { runes: isRunesMode(source) })
    .map(key)
    .sort((a, b) => a.localeCompare(b));

test("matches svelte's compile on the corpus, with and without its svelte-ignore comments", () => {
  let compared = 0;
  let warned = 0;
  for (const path of corpusFiles(SVELTE_FILES)) {
    const written = readCorpus(path);
    for (const source of [written, written.replace(SVELTE_IGNORE, "")]) {
      const expected = svelteWarnings(source);
      if (expected === undefined || attempt(() => parse(source)) === undefined)
        continue;
      compared++;
      warned += expected.length;
      expect([path, sveastWarnings(source)]).toEqual([path, expected]);
    }
  }
  expect(compared).toBeGreaterThan(600);
  expect(warned).toBeGreaterThan(40);
  // It compiles each component twice.
}, 30_000);

const CASES: Record<string, string> = {
  "an img without alt": '<img src="a.png" />',
  "a click handler on a div": "<div on:click={() => {}}>a</div>",
  "an unknown role, with a suggestion": '<div role="buton">a</div>',
  "an unknown aria attribute, with a suggestion":
    '<div aria-labeledby="a">a</div>',
  "a role with fallbacks": '<div role="foo button" tabindex="0">a</div>',
  "a redundant role, but on a list":
    '<ul role="list"><li>a</li></ul><button role="button">a</button>',
  "a footer outside and inside a section":
    '<footer role="contentinfo">a</footer><section><footer role="contentinfo">a</footer></section>',
  "autofocus in a dialog":
    "<dialog><input autofocus /></dialog><input autofocus />",
  "a label around a component": "<label>A <Input /></label><label>B</label>",
  "a figcaption in the middle of a figure":
    "<figure><img src=a alt=b /><figcaption>c</figcaption><p>d</p></figure>",
  "invalid aria values":
    '<div aria-hidden="maybe" aria-level="1.5" aria-current="no">a</div>',
  "an invalid autocomplete": '<input type="text" autocomplete="nope" />',
  "a legacy ignore in legacy mode":
    "<!-- svelte-ignore a11y-missing-attribute -->\n<img src=a />",
  "a legacy ignore in runes mode":
    "<script>let a = $state(1);</script><!-- svelte-ignore a11y-missing-attribute -->\n<img src={a} />",
  "runes mode reads codes up to the first without a comma":
    "<script>let a = $state(1);</script><!-- svelte-ignore a11y_autofocus a11y_missing_attribute -->\n<img src={a} autofocus />",
  "an ignore covers what's inside":
    "<!-- svelte-ignore a11y_missing_attribute -->\n<div><img src=a /></div><img src=b />",
  "an ignore on a figcaption doesn't cover the figure's warning about it":
    "<figure><img src=a alt=b /><!-- svelte-ignore a11y_figcaption_index -->\n<figcaption>c</figcaption><p>d</p></figure>",
  "a dynamic element":
    '<svelte:element this="div" on:click={() => {}} role="button">a</svelte:element>',
  "a spread silences most checks":
    "<img {...props} /><div {...props} on:click={() => {}}>a</div>",
  "roles named after Object.prototype's members":
    '<div role="constructor">a</div><div role="__proto__">a</div><div role="toString">a</div><div {...props} role="valueOf">a</div>',
  "an aria attribute named after Object.prototype's member":
    '<div aria-constructor="a">a</div>',
  "input and menuitem types named after Object.prototype's members":
    '<input type="toString" aria-checked="true" /><menuitem type="constructor" aria-checked="true"></menuitem>',
};

for (const [name, source] of Object.entries(CASES)) {
  test(name, () => {
    const expected = svelteWarnings(source);
    expect(expected).toBeDefined();
    expect(sveastWarnings(source)).toEqual(expected as string[]);
  });
}

// svelte's compile throws here, as it looks the element up in an object.
test("an element named after Object.prototype's member", () => {
  expect(sveastWarnings("<constructor></constructor>")).toEqual([]);
});
