import { parse } from "sveast";
import type { Json } from "../scripts/shared";
import { acornExpressionParses, parseExpressionAt } from "../src/acorn-bridge";
import { htmlEntityNames } from "../src/entity-names";
import { readExpression } from "../src/expression";
import { setSource } from "../src/locator";
import { TemplateParserState } from "../src/state";
import { TypeScriptParser } from "../src/typescript-parser";

const FAST_PATH_SHAPES = [
  "a",
  "_",
  "$a",
  "$$restProps",
  "a.b.c",
  "a.class",
  "a[0]",
  "a[10].b",
  'a["k"]',
  "a['k']",
  '$$props["aria-label"]',
  "true",
  "false",
  "null",
  "undefined",
  "42",
  "0",
  '"str"',
  "'str'",
  '""',
  '"a\'b"',
  "'a\"b'",
  "!x",
  "!!x",
  "! x",
  "!x.y",
  'a === "b"',
  "a !== b",
  "a == b",
  "a != b",
  "a!== b",
  "a && b",
  "a || b",
  "a ?? b",
  "!a && !b",
  "a.b === 1",
  '"x" === a',
  "änderung.übersicht",
  "π",
  "a ? b : c",
  "a ? b : c ? d : e",
  "a ? b ? c : d : e",
  'open ? "region" : undefined',
  "a ?b: c",
  "a + b",
  "a - b - c",
  "a + b * c",
  "a * b + c",
  "a / b % c",
  "a < b",
  "a > b",
  "a <= b && c >= d",
  "a + b === c",
  "a || b && c",
  "a && b || c",
  "a ?? b ?? c",
  "a ?? b ? c : d",
  "a - -b",
  "-1",
  "-a.b",
  "!-a",
  "f()",
  "f(a)",
  "f( a , b )",
  "a.b()",
  "a.b(c).d",
  "f(a)(b)",
  "f(a ? b : c, d + e)",
  "f(g(h))",
  "a[0](b)",
  'getIconSize(size) === "sm"',
  "!f(x) && g(y)",
  "f(a)[0]",
  "async(x)",
  "a ?\n  b :\n  c",
  "a /b/ c",
];

const FALLBACK_SHAPES = [
  "  a",
  "a, b",
  "a in b",
  "a instanceof b",
  "a ||= b",
  "a &&= b",
  "a ??= b",
  "a = b",
  "a?.b",
  "a?.[0]",
  "() => a",
  "(a) => a + 1",
  "[a, b]",
  "{ a: 1 }",
  // a template literal; split so it isn't mistaken for a placeholder in a plain string
  ["`t$", "{a}`"].join(""),
  "new X()",
  "a.b[c]",
  "a[b]",
  "+x",
  "a ** b",
  "-a ** b",
  "a << b",
  "a | b",
  "a & b",
  "a ?? b || c",
  "a || b ?? c",
  "a && b ?? c",
  "a ?? b && c",
  "a ?.5 : 1",
  "a?.b ? c : d",
  "a ? b = c : d",
  "a ? b : c = d",
  "f(...a)",
  "f(a,)",
  "f(a, ...b)",
  "f(a)?.b",
  "f(a)`t`",
  "a.b(c) => d",
  "async (x) => x",
  "async(x) => x",
  "a+ +b",
  "a--",
  "--a",
  "a -= b",
  "eval(x)",
  "a //c\n",
  "a /* c */ + b",
  "f(/* c */ a)",
  "a ? b : (c)",
  "(a) ? b : c",
  "f((a))",
  "a ? b",
  "a ? b :",
  "f(a",
  "typeof a",
  "void 0",
  "this",
  "this.x",
  "true.x",
  "5.5",
  "5e3",
  "0x1F",
  "0.5",
  "1_000",
  '"a\\nb"',
  "a /* trailing */",
  "a . b",
];

const ERROR_SHAPES = [
  "05",
  "00",
  "let",
  "class",
  "5abc",
  '"unterminated',
  "a[01]",
];

const TS_FALLBACK_SHAPES = [
  "a < b",
  "a > b",
  "f<T>(a)",
  "a ? (b) : c",
  "a as string",
  "a!",
  "a satisfies string",
  "f<string>(a)",
  "a as const",
];

const TS_FAST_PATH_SHAPES = [
  "a",
  "a.b",
  'size === "sm"',
  "!flag",
  '"str"',
  "a ? b : c",
  "f(a, b)",
  "a + b * c",
  "a ?? b",
  "a ? b : f(c)",
];

const TS_PREFIX = '<script lang="ts"></script>';

type Outcome = { node: Json; end: number } | { throws: true };

function strip(node: object): Json {
  return JSON.parse(
    JSON.stringify(node, (_, value) =>
      typeof value === "bigint" ? `bigint:${value}` : value,
    ),
  );
}

function referenceOutcome(
  source: string,
  index: number,
  isTypeScript: boolean,
  loc: boolean,
): Outcome {
  setSource(source);
  const context = {
    source,
    isTypeScript,
    typescript: TypeScriptParser,
    loc,
    comments: true,
    root: { comments: [] },
  };
  try {
    const { node, end } = parseExpressionAt(context, source, index);
    return { node: strip(node), end };
  } catch {
    return { throws: true };
  }
}

function actualOutcome(source: string, index: number, loc: boolean): Outcome {
  setSource(source);
  const state = new TemplateParserState(
    source,
    source.length,
    { typescript: TypeScriptParser, entityNames: htmlEntityNames },
    { loc },
  );
  state.index = index;
  try {
    const node = readExpression(state);
    return { node: strip(node), end: state.index };
  } catch {
    return { throws: true };
  }
}

function runShape(expression: string, useTsPrefix: boolean) {
  const prefix = useTsPrefix ? TS_PREFIX : "";
  const source = `${prefix}{${expression}}`;
  const index = prefix.length + 1;

  let acornCalls = 0;
  const actual: Outcome[] = [];
  const reference: Outcome[] = [];
  for (const loc of [true, false]) {
    reference.push(referenceOutcome(source, index, useTsPrefix, loc));
    const before = acornExpressionParses.count;
    actual.push(actualOutcome(source, index, loc));
    if (!loc) acornCalls = acornExpressionParses.count - before;
  }
  return { acornCalls, actual, reference };
}

describe("expression fast path matches acorn", () => {
  test.each(FAST_PATH_SHAPES)("fast path, no acorn: %s", (expression) => {
    const run = runShape(expression, false);
    expect(run.actual).toEqual(run.reference);
    expect(run.acornCalls).toBe(0);
  });

  test.each(FALLBACK_SHAPES)("falls back to acorn: %s", (expression) => {
    const run = runShape(expression, false);
    expect(run.actual).toEqual(run.reference);
    expect(run.acornCalls).toBeGreaterThan(0);
  });

  test.each(ERROR_SHAPES)("rejected by both: %s", (expression) => {
    const run = runShape(expression, false);
    expect(run.actual).toEqual(run.reference);
    expect(run.acornCalls).toBeGreaterThan(0);
  });

  test.each(TS_FAST_PATH_SHAPES)(
    "fast path under lang=ts: %s",
    (expression) => {
      const run = runShape(expression, true);
      expect(run.actual).toEqual(run.reference);
      expect(run.acornCalls).toBe(0);
    },
  );

  test.each(TS_FALLBACK_SHAPES)("falls back to TS acorn: %s", (expression) => {
    const run = runShape(expression, true);
    expect(run.actual).toEqual(run.reference);
    expect(run.acornCalls).toBeGreaterThan(0);
  });
});

describe("fast path fires end-to-end", () => {
  test("markup with only trivial expressions parses without any acorn expression call", () => {
    const before = acornExpressionParses.count;
    parse(
      '<div class:a={x === "y"} data-b={items[0]} data-c={flag ?? "z"} data-d={x ? 1 : 2}>{!flag}{a.b}{f(x)}</div>',
    );
    expect(acornExpressionParses.count).toBe(before);
  });

  test("non-trivial expressions still reach acorn", () => {
    const before = acornExpressionParses.count;
    parse("<div data-a={() => 1}>{a?.b}</div>");
    expect(acornExpressionParses.count).toBe(before + 2);
  });
});
