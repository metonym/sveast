import { ParseError, parse, parseModule } from "sveast";
import { parse as svelteParse } from "svelte/compiler";
import { byCodeUnit } from "../scripts/shared";

const hasKey = (value: object, key: string): boolean =>
  JSON.stringify(value).includes(`"${key}":`);

test("exports the parsers, walk and its helpers, and ParseError", async () => {
  expect(Object.keys(await import("sveast")).sort(byCodeUnit)).toEqual([
    "ParseError",
    "SKIP",
    "STOP",
    "extractIdentifiers",
    "isReference",
    "isValidType",
    "parse",
    "parseImportsExports",
    "parseModule",
    "visitorKeys",
    "walk",
  ]);
});

test("parseModule parses a module like a component's script", () => {
  const source = "// a\nexport const x: number = 1; // b\n";
  const program = parseModule(source, { typescript: true });
  const script = svelteParse(`<script lang="ts">${source}</script>`, {
    modern: true,
  }).instance?.content;
  const plain = (value: object | undefined) =>
    JSON.parse(
      JSON.stringify(value, (key, item) =>
        key === "loc" ||
        (typeof item === "number" && (key === "start" || key === "end"))
          ? undefined
          : item,
      ),
    );
  expect(plain(program)).toEqual(plain(script));
  expect(() => parseModule("let a: number;")).toThrow(
    expect.objectContaining({ code: "js_parse_error" }),
  );
});

test("loc and name_loc only with `loc: true`", () => {
  const source = '<script>let a = 1;</script>\n<div class="x">{a}</div>';
  expect(hasKey(parse(source), "loc")).toBe(false);
  expect(hasKey(parse(source), "name_loc")).toBe(false);

  const ast = parse(source, { loc: true });
  expect(ast.instance?.content.loc).toEqual({
    start: { line: 1, column: 0 },
    end: { line: 1, column: 27 },
  });
  const div = ast.fragment.nodes[1];
  if (div?.type !== "RegularElement") throw new Error("expected the <div>");
  expect(div.name_loc).toEqual({
    start: { line: 2, column: 1, character: 29 },
    end: { line: 2, column: 4, character: 32 },
  });
});

test("`css: false` skips the stylesheet but keeps its bounds", () => {
  const source =
    '<style>/* </style> */ .a { content: "</style>" }</style><p />';
  const full = parse(source).css;
  const skipped = parse(source, { css: false }).css;
  expect(full?.children).toHaveLength(1);
  expect(skipped).toEqual({ ...full, children: [], comments: [] });
  expect(() => parse("<style>.a {</style>")).toThrow(ParseError);
  expect(() => parse("<style>.a {</style>", { css: false })).not.toThrow();
});

test("`script: false` skips the scripts but keeps their bounds", () => {
  const source =
    '<script lang="ts">let a: number = 1; // b</script><p>{a /* c */}</p>';
  const full = parse(source);
  const skipped = parse(source, { script: false });
  expect(full.instance?.content.body).toHaveLength(1);
  expect(skipped.instance).toEqual({
    ...full.instance,
    content: {
      type: "Program",
      start: 18,
      end: 41,
      body: [],
      sourceType: "module",
    },
  });
  expect(skipped.fragment).toEqual(full.fragment);
  expect(skipped.comments).toEqual([full.comments[1]]);
  expect(() => parse("<script>let</script>")).toThrow(ParseError);
  expect(() => parse("<script>let</script>", { script: false })).not.toThrow();
  expect(() => parse("<p>{let}</p>", { script: false })).toThrow(ParseError);
});

test("`comments: false` drops JavaScript comments but keeps HTML and CSS ones", () => {
  const source =
    "<!-- doc -->\n<script>// a\nlet a = 1; /* b */</script>\n" +
    "<p /* c */ {...a}>{a /* d */}</p><!-- e --><style>/* f */</style>";
  const full = parse(source);
  const skipped = parse(source, { comments: false });
  expect(full.comments).toHaveLength(4);
  expect(hasKey(full, "leadingComments")).toBe(true);
  expect(skipped.comments).toEqual([]);
  expect(hasKey(skipped, "leadingComments")).toBe(false);
  expect(hasKey(skipped, "trailingComments")).toBe(false);
  expect(skipped.fragment.nodes.map((node) => node.type)).toEqual(
    full.fragment.nodes.map((node) => node.type),
  );
  expect(skipped.css).toEqual(full.css);

  const program = parseModule("// a\nexport const x = 1; // b\n", {
    comments: false,
  });
  expect(program.body).toHaveLength(1);
  expect(hasKey(program, "leadingComments")).toBe(false);
  expect(hasKey(program, "trailingComments")).toBe(false);
});

test("syntax errors are ParseErrors with svelte's code and position", () => {
  let error: ParseError | undefined;
  try {
    parse("<div>\n  {#if x}\n</div>");
  } catch (thrown) {
    if (thrown instanceof ParseError) error = thrown;
  }
  expect(error).toBeInstanceOf(ParseError);
  expect(error).toBeInstanceOf(Error);
  expect(error).toMatchObject({
    name: "ParseError",
    code: "element_invalid_closing_tag",
    message:
      "`</div>` attempted to close an element that was not open\nhttps://svelte.dev/e/element_invalid_closing_tag",
    reason: "`</div>` attempted to close an element that was not open",
    position: [16, 16],
    start: { line: 3, column: 0, character: 16 },
    end: { line: 3, column: 0, character: 16 },
  });
  expect(error?.frame).toBe("1: <div>\n2:   {#if x}\n3: </div>\n   ^");
});

test.each([
  ["{#if x}", "block_unclosed"],
  ["<div>", "element_unclosed"],
  ["<svelte:portal />", "svelte_meta_invalid_tag"],
  ["<div><svelte:head /></div>", "svelte_meta_invalid_placement"],
  ["<svelte:component />", "svelte_component_missing_this"],
  ['<div a="1" a="2" />', "attribute_duplicate"],
  ["{x", "expected_token"],
  ["{a +}", "js_parse_error"],
])("rejects %j with %s", (source, code) => {
  expect(() => parse(source)).toThrow(expect.objectContaining({ code }));
});

test("a ParseError's message is its reason, a line break, then its link", () => {
  const errors: unknown[] = [];
  for (const run of [
    () => parse("{a +}"),
    () => parse("<div>\n  {#if x}\n</div>"),
    () => parseModule("let a = ;"),
  ]) {
    try {
      run();
    } catch (thrown) {
      errors.push(thrown);
    }
  }
  expect(errors).toEqual([
    expect.objectContaining({
      code: "js_parse_error",
      reason: "Unexpected token",
      message: "Unexpected token\nhttps://svelte.dev/e/js_parse_error",
    }),
    expect.objectContaining({ code: "element_invalid_closing_tag" }),
    expect.objectContaining({
      code: "js_parse_error",
      reason: "Unexpected token",
      message: "Unexpected token\nhttps://svelte.dev/e/js_parse_error",
    }),
  ]);
  for (const error of errors) {
    if (!(error instanceof ParseError)) throw error;
    expect(error.message).toBe(
      `${error.reason}\nhttps://svelte.dev/e/${error.code}`,
    );
  }
});

test("drops a byte order mark, as svelte does", () => {
  expect(parse("﻿<p />").fragment.nodes[0]).toMatchObject({
    type: "RegularElement",
    start: 0,
  });
});
