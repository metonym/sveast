import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "sveast";
import { checkSyntax } from "../examples/check-syntax";
import { componentsUsed } from "../examples/components-used";
import { extractStyles } from "../examples/extract-styles";
import { importsOf, moduleGraph } from "../examples/module-graph";
import { declaration, propTypes } from "../examples/prop-types";
import { propsOf } from "../examples/props";
import { svelteMode } from "../examples/svelte-mode";
import { unusedBindings } from "../examples/unused-bindings";
import { unusedClasses } from "../examples/unused-classes";

const CARBON = join(import.meta.dir, "corpus/carbon");

const APP = `<script lang="ts">
  import Button from "./Button.svelte";
  import * as Modal from "./modal";
  import Icon from "@icons/Icon.svelte";

  let { open = false, Header } = $props();
</script>

{#if open}
  <Modal.Root>
    <Header />
    <Button><Icon /></Button>
  </Modal.Root>
{/if}
`;

const BUTTON = `<script lang="ts">
  let { size = "md", "aria-label": label, ...rest }: Props = $props();
</script>

<button class={size} {...rest}>{label}</button>

<style lang="scss">
  $gap: 4px;
  button { padding: $gap; }
</style>
`;

const CARD = `<script>
  let { active } = $props();
</script>

<div class="card" class:active>
  <h2 class="title">Title</h2>
</div>

<style>
  .card { padding: 1rem; }
  .active, .stale { color: red; }
  .card :global(.child) {}
  .card:not(.disabled) {}
  :global { .theme-dark {} }
  .footer :global .link {}
  @media (min-width: 40rem) {
    .wide {}
  }
</style>
`;

const PANEL = `<script lang="ts">
  import { onMount, tick } from "svelte";
  import { fade } from "svelte/transition";
  import Icon from "./Icon.svelte";
  import * as Menu from "./menu";
  import { open, type Item } from "./util";

  let { items }: { items: Item[] } = $props();
  let [first, second] = $derived(items);
  function toggle() {
    $open = !$open;
  }
  function unused(value: number) {
    return value;
  }
  function tooltip(node: HTMLElement) {}
  onMount(() => {});
</script>

<Menu.Root>
  <button onclick={toggle} use:tooltip>{first.label}</button>
  {#if $open}<div transition:fade><Icon /></div>{/if}
</Menu.Root>
`;

const LEGACY = `<script>
  /**
   * The button's kind.
   * Defaults to the primary style.
   * @type {"primary" | "ghost"}
   */
  export let kind = "primary";

  /**
   * The text.
   * @type {string; alert(1)}
   */
  export let label;

  /** @type {{ id: string } | null} */
  export let item = null;

  export let disabled = false;

  $: classes = \`btn btn--\${kind}\`;
</script>

<button class={classes} {disabled}>{label}</button>
`;

const FILES = {
  "App.svelte": APP,
  "Button.svelte": BUTTON,
  "Card.svelte": CARD,
  "Broken.svelte": "{#if open}\n  <p>Hi</p>\n",
  "store.svelte.ts": "export const count: number = $state(0);\n",
  "broken.ts": "export const count: number = ;\n",
  "Panel.svelte": PANEL,
  "Legacy.svelte": LEGACY,
  "index.ts":
    'export { default as Panel } from "./Panel.svelte";\nexport * from "./util";\nexport { tick } from "svelte";\n',
  "util.ts":
    'import { writable } from "svelte/store";\nexport interface Item { label: string }\nexport const open = writable(false);\n',
};

let dir = "";

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "sveast-examples-"));
  for (const [file, source] of Object.entries(FILES)) {
    writeFileSync(join(dir, file), source);
  }
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function run(example: string, files: Array<keyof typeof FILES>) {
  const proc = Bun.spawn({
    cmd: ["bun", join(import.meta.dir, "../examples", example), ...files],
    cwd: dir,
    env: { ...process.env, FORCE_COLOR: undefined, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe("components-used", () => {
  test("maps each component to its import", () => {
    expect(componentsUsed(APP)).toEqual({
      "Modal.Root": "./modal",
      Header: null,
      Button: "./Button.svelte",
      Icon: "@icons/Icon.svelte",
    });
    expect(componentsUsed(BUTTON)).toEqual({});
  });

  test("prints the dependency graph", async () => {
    const { stdout, exitCode } = await run("components-used.ts", [
      "App.svelte",
      "Button.svelte",
    ]);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({
      "App.svelte": {
        "Modal.Root": "modal",
        Header: null,
        Button: "Button.svelte",
        Icon: "@icons/Icon.svelte",
      },
      "Button.svelte": {},
    });
  });
});

describe("props", () => {
  test("reads names, defaults and the rest", () => {
    expect(propsOf(APP)).toEqual({
      props: [{ name: "open", default: "false" }, { name: "Header" }],
    });
    expect(propsOf(BUTTON)).toEqual({
      props: [{ name: "size", default: '"md"' }, { name: "aria-label" }],
      rest: "rest",
    });
    expect(propsOf("<script>let props = $props();</script>")).toEqual({
      props: [],
      rest: "props",
    });
    expect(propsOf("<script>let { a } = $props.id();</script>")).toBe(
      undefined,
    );
    expect(propsOf("<p>No script</p>")).toBe(undefined);
  });

  test("prints each component's props", async () => {
    const { stdout, exitCode } = await run("props.ts", [
      "App.svelte",
      "Button.svelte",
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toBe(
      'App.svelte: open = false, Header\nButton.svelte: size = "md", aria-label, ...rest\n',
    );
  });
});

describe("check-syntax", () => {
  test("formats svelte's error with its frame", () => {
    expect(checkSyntax("App.svelte", APP)).toBe(undefined);
    expect(checkSyntax("Button.svelte", BUTTON)).toBe(undefined);
    expect(checkSyntax("store.svelte.ts", FILES["store.svelte.ts"])).toBe(
      undefined,
    );
    expect(checkSyntax("Broken.svelte", FILES["Broken.svelte"])).toBe(
      "Broken.svelte:1:1 block_unclosed: Block was left open\n1: {#if open}\n    ^\n2:   <p>Hi</p>\n3: ",
    );
    expect(checkSyntax("broken.ts", FILES["broken.ts"])).toBe(
      "broken.ts:1:30 js_parse_error: Unexpected token\n1: export const count: number = ;\n                                ^\n2: ",
    );
  });

  test("exits non-zero on any error", async () => {
    const failed = await run("check-syntax.ts", [
      "App.svelte",
      "Broken.svelte",
      "store.svelte.ts",
      "broken.ts",
    ]);
    expect(failed.exitCode).toBe(1);
    expect(failed.stdout).toBe("");
    expect(failed.stderr).toBe(
      `${checkSyntax("Broken.svelte", FILES["Broken.svelte"])}\n${checkSyntax("broken.ts", FILES["broken.ts"])}\n`,
    );

    const passed = await run("check-syntax.ts", [
      "App.svelte",
      "Button.svelte",
      "store.svelte.ts",
    ]);
    expect(passed).toEqual({ stdout: "", stderr: "", exitCode: 0 });
  });
});

describe("extract-styles", () => {
  test("returns the styles unparsed, with their lang and line", () => {
    expect(extractStyles(BUTTON)).toEqual({
      styles: "\n  $gap: 4px;\n  button { padding: $gap; }\n",
      lang: "scss",
      line: 7,
    });
    expect(extractStyles("<p />\n<style>p { color: red }</style>")).toEqual({
      styles: "p { color: red }",
      lang: "css",
      line: 2,
    });
    expect(extractStyles(APP)).toBe(undefined);
    expect(() => parse(BUTTON)).toThrow(
      expect.objectContaining({ code: "css_expected_identifier" }),
    );
  });

  test("prints each component's styles", async () => {
    const { stdout, exitCode } = await run("extract-styles.ts", [
      "App.svelte",
      "Button.svelte",
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toBe(
      "/* Button.svelte:7 (scss) */\n\n  $gap: 4px;\n  button { padding: $gap; }\n\n",
    );
  });
});

describe("unused-classes", () => {
  test("reports declared classes the markup never uses", () => {
    expect(unusedClasses(CARD)).toEqual({
      unused: [
        { name: "stale", line: 11 },
        { name: "footer", line: 15 },
        { name: "wide", line: 17 },
      ],
      dynamic: false,
    });
    expect(
      unusedClasses('<p class="a {b}"></p><style>.a {} .c {}</style>'),
    ).toEqual({ unused: [{ name: "c", line: 1 }], dynamic: true });
    expect(unusedClasses("<p class={b}></p>")).toEqual({
      unused: [],
      dynamic: true,
    });
  });

  test("prints each unused class", async () => {
    const { stdout, exitCode } = await run("unused-classes.ts", [
      "App.svelte",
      "Card.svelte",
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toBe(
      "Card.svelte:11 .stale\nCard.svelte:15 .footer\nCard.svelte:17 .wide\n",
    );
  });
});

describe("module-graph", () => {
  test("reads a component's imports without parsing its scripts", () => {
    expect(importsOf("Panel.svelte", PANEL)).toEqual([
      "svelte",
      "svelte/transition",
      "./Icon.svelte",
      "./menu",
      "./util",
    ]);
    expect(importsOf("index.ts", FILES["index.ts"])).toEqual([
      "./Panel.svelte",
      "./util",
      "svelte",
    ]);
  });

  test("follows Carbon's Button through its components and modules", async () => {
    const graph = await moduleGraph([join(CARBON, "Button/index.js")]);
    expect(graph.files[join(CARBON, "Button/index.js")]).toEqual([
      join(CARBON, "Button/Button.svelte"),
      join(CARBON, "Button/ButtonSet.svelte"),
      join(CARBON, "Button/ButtonSkeleton.svelte"),
    ]);
    expect(graph.files[join(CARBON, "Portal/FloatingPortal.svelte")]).toContain(
      join(CARBON, "Portal/Portal.svelte"),
    );
    expect(Object.keys(graph.files)).toHaveLength(22);
    expect(graph.missing).toEqual([]);
    expect(graph.packages).toEqual(["svelte", "svelte/store"]);
  });

  test("prints the graph with missing files and packages", async () => {
    const { stdout, exitCode } = await run("module-graph.ts", ["index.ts"]);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({
      files: {
        "index.ts": ["Panel.svelte", "util.ts"],
        "Panel.svelte": ["util.ts"],
        "util.ts": [],
      },
      missing: ["Panel.svelte: ./Icon.svelte", "Panel.svelte: ./menu"],
      packages: ["svelte", "svelte/transition", "svelte/store"],
    });
  });
});

describe("unused-bindings", () => {
  test("reports top-level bindings neither the script nor the markup uses", () => {
    expect(unusedBindings(PANEL)).toEqual([
      { name: "tick", line: 2 },
      { name: "second", line: 9 },
      { name: "unused", line: 13 },
    ]);
    expect(unusedBindings(LEGACY)).toEqual([]);
  });

  test("finds nothing unused in Carbon", () => {
    const files = readdirSync(CARBON, { recursive: true, encoding: "utf8" })
      .filter((file) => file.endsWith(".svelte"))
      .map((file) => join(CARBON, file));
    expect(files.length).toBeGreaterThan(300);
    const unused = files.flatMap((file) =>
      unusedBindings(readFileSync(file, "utf8")),
    );
    expect(unused).toEqual([]);
  });

  test("prints each unused binding", async () => {
    const { stdout, exitCode } = await run("unused-bindings.ts", [
      "Panel.svelte",
      "Legacy.svelte",
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toBe(
      "Panel.svelte:2 tick\nPanel.svelte:9 second\nPanel.svelte:13 unused\n",
    );
  });
});

describe("svelte-mode", () => {
  test("stops at the first rune, else reports the first legacy syntax", () => {
    expect(svelteMode(PANEL)).toEqual({
      mode: "runes",
      reason: "$props",
      line: 8,
    });
    expect(svelteMode(LEGACY)).toEqual({
      mode: "legacy",
      reason: "export let",
      line: 7,
    });
    expect(svelteMode("<p>{$$props.title}</p>")).toEqual({
      mode: "legacy",
      reason: "$$props",
      line: 1,
    });
    expect(svelteMode("<svelte:options runes={false} />")).toEqual({
      mode: "legacy",
      reason: "<svelte:options runes={false}>",
      line: 1,
    });
    expect(svelteMode(APP)).toEqual({
      mode: "runes",
      reason: "$props",
      line: 6,
    });
    expect(svelteMode("<p>{count}</p>")).toEqual({ mode: "either" });
  });

  test("prints each component's mode", async () => {
    const { stdout, exitCode } = await run("svelte-mode.ts", [
      "Panel.svelte",
      "Legacy.svelte",
      "Card.svelte",
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toBe(
      "Panel.svelte: runes ($props, line 8)\nLegacy.svelte: legacy (export let, line 7)\nCard.svelte: runes ($props, line 2)\n",
    );
  });
});

describe("prop-types", () => {
  test("types props from JSDoc, rejecting what isn't one type", () => {
    expect(propTypes(LEGACY)).toEqual({
      props: [
        {
          name: "kind",
          type: '"primary" | "ghost"',
          optional: true,
          description: "The button's kind.\nDefaults to the primary style.",
        },
        {
          name: "label",
          type: "any",
          optional: false,
          description: "The text.",
        },
        {
          name: "item",
          type: "{ id: string } | null",
          optional: true,
          description: "",
        },
        { name: "disabled", type: "boolean", optional: true, description: "" },
      ],
      invalid: [{ name: "label", type: "string; alert(1)" }],
    });
    expect(
      propTypes('<script lang="ts">export let size: "sm" | "lg";</script>')
        .props,
    ).toEqual([
      { name: "size", type: '"sm" | "lg"', optional: false, description: "" },
    ]);
  });

  test("declares Carbon's Button props", () => {
    const { props, invalid } = propTypes(
      readFileSync(join(CARBON, "Button/Button.svelte"), "utf8"),
    );
    expect(invalid).toEqual([]);
    expect(declaration("Button", props)).toContain(
      '  /** Specify the kind of button. */\n  kind?: "primary" | "secondary" | "tertiary" | "ghost" | "danger" | "danger-tertiary" | "danger-ghost";\n',
    );
  });

  test("prints a declaration per component", async () => {
    const { stdout, stderr, exitCode } = await run("prop-types.ts", [
      "Legacy.svelte",
    ]);
    expect(exitCode).toBe(0);
    expect(stderr).toBe(
      "Legacy.svelte: label's @type {string; alert(1)} isn't one type\n",
    );
    expect(stdout).toBe(
      'export interface LegacyProps {\n  /**\n   * The button\'s kind.\n   * Defaults to the primary style.\n   */\n  kind?: "primary" | "ghost";\n  /** The text. */\n  label: any;\n  item?: { id: string } | null;\n  disabled?: boolean;\n}\n\n',
    );
  });
});
