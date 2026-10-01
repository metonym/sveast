import { ParseError, parse, parseModule } from "sveast";
import { parse as svelteParse } from "svelte/compiler";
import { byCodeUnit } from "../scripts/shared";

const hasKey = (value: object, key: string): boolean =>
  JSON.stringify(value).includes(`"${key}":`);

test("exports parse, parseModule and ParseError", async () => {
  expect(Object.keys(await import("sveast")).sort(byCodeUnit)).toEqual([
    "ParseError",
    "parse",
    "parseModule",
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

test("drops a byte order mark, as svelte does", () => {
  expect(parse("﻿<p />").fragment.nodes[0]).toMatchObject({
    type: "RegularElement",
    start: 0,
  });
});
