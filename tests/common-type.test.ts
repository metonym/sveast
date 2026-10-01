import { isCommonType } from "../src/common-type";
import { parsesAsType } from "../src/is-valid-type";

const COMMON = [
  "string",
  "boolean",
  "number[]",
  "() => void",
  '"sm" | "md" | "lg"',
  "HTMLElement | null",
  "Item[] | null",
  "Array<{ id: string; label?: string }>",
  "{ a: string, 'b'?: number; [\"c\"]: C; [key: string]: any }",
  "(event: MouseEvent, detail?: { x: number }) => void",
  "(...rest: unknown[]) => Promise<void>",
  "Record<string, (value: unknown) => boolean>",
  "keyof HTMLElementTagNameMap",
  "typeof value",
  "[string, number]",
  "[]",
  "A & B | C[]",
  "Map<string, Set<number>>['size']",
  "-1 | 0 | 1.5",
  "true | void[]",
  'typeof import("carbon-icons-svelte").CarbonIcon',
  'import("svelte").ComponentProps<import("svelte").SvelteComponent>',
];

const INSERTS = [
  "|",
  "&",
  "(",
  ")",
  "[",
  "]",
  "{",
  "}",
  "<",
  ">",
  ",",
  ";",
  ":",
  "?",
  ".",
  "...",
  "=>",
  "-",
  "0",
  '"',
  "'",
  "\\",
  " ",
  "a",
  "\n",
  "//",
  "/*",
];

const WORDS = [
  "class",
  "default",
  "get",
  "infer",
  "keyof",
  "let",
  "new",
  "null",
  "readonly",
  "this",
  "typeof",
  "unique",
  "void",
  "yield",
];

test("reads common JSDoc type shapes", () => {
  expect(COMMON.map((text) => [text, isCommonType(text)])).toEqual(
    COMMON.map((text) => [text, true]),
  );
});

test("leaves invalid or unusual text to the parser", () => {
  const texts = [
    '"a" | ',
    "Array<string",
    "?string",
    "Array.<string>",
    "class",
    "a\n| b",
    "string // c",
    "string /* c */",
    "`a`",
    "T extends U ? A : B",
    "{ get a(): string }",
    "(a, b) => void",
    "01",
    "1e3",
  ];
  expect(texts.map((text) => [text, isCommonType(text)])).toEqual(
    texts.map((text) => [text, false]),
  );
});

test("never reads as a type what the parser rejects", () => {
  const unsound: string[] = [];
  const check = (text: string) => {
    if (isCommonType(text) && !parsesAsType(text, true)) unsound.push(text);
  };
  for (const text of COMMON) {
    for (let i = 0; i <= text.length; i++) {
      check(text.slice(0, i) + text.slice(i + 1));
      for (const insert of [...INSERTS, ...WORDS.map((word) => ` ${word} `)]) {
        check(text.slice(0, i) + insert + text.slice(i));
      }
    }
  }
  expect(unsound).toEqual([]);
});
