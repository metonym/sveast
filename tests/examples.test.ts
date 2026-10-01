import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "sveast";
import { checkSyntax } from "../examples/check-syntax";
import { componentsUsed } from "../examples/components-used";
import { extractStyles } from "../examples/extract-styles";
import { propsOf } from "../examples/props";
import { unusedClasses } from "../examples/unused-classes";

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

const FILES = {
  "App.svelte": APP,
  "Button.svelte": BUTTON,
  "Card.svelte": CARD,
  "Broken.svelte": "{#if open}\n  <p>Hi</p>\n",
  "store.svelte.ts": "export const count: number = $state(0);\n",
  "broken.ts": "export const count: number = ;\n",
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
