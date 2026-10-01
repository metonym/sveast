import { isValidType, parseModule } from "sveast";

const VALID = [
  "string",
  '"sm" | "md" | "lg"',
  "Item[] | null",
  "Array<{ id: string; label?: string }>",
  "(event: MouseEvent, detail?: { x: number }) => void",
  "Record<string, (value: unknown) => boolean>",
  "keyof HTMLElementTagNameMap",
  "typeof value",
  "[string, number]",
  "A & B | C[]",
  "Map<string, Set<number>>['size']",
  "-1 | 0 | 1.5",
  "{ [key: string]: any }",
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
  "=>",
  '"',
  " ",
  "a",
  "\n",
  "/*",
  "*/",
  "//",
  "`",
];

function asTypeAlias(text: string): boolean {
  try {
    return (
      parseModule(`type T = ${text}\n;`, { typescript: true }).body.length === 1
    );
  } catch {
    return false;
  }
}

const verdicts = (texts: string[], options?: { inline: boolean }) =>
  texts.map((text) => [text, isValidType(text, options)]);

test("accepts common JSDoc types", () => {
  expect(verdicts(VALID)).toEqual(VALID.map((text) => [text, true]));
});

test("accepts the types a recognizer would leave to a parser", () => {
  const texts = [
    "a\n| b",
    "| 'a' | 'b'",
    "T extends string ? A : B",
    "{ readonly [K in keyof T]?: T[K] }",
    // split so it isn't read as a placeholder
    ["`a-$", "{B}`"].join(""),
    "<T>(a: T) => T",
    "new () => T",
    "string /* why */",
    " string\n",
  ];
  expect(verdicts(texts)).toEqual(texts.map((text) => [text, true]));
});

test("rejects text that isn't exactly one type", () => {
  const texts = [
    "",
    " ",
    '"a" | ',
    "Array<string",
    "?string",
    "Array.<string>",
    "string string",
    "A\nextends B ? C : D",
    "/* string */",
  ];
  expect(verdicts(texts)).toEqual(texts.map((text) => [text, false]));
});

test("rejects text that would end the type and start a statement", () => {
  const texts = [
    "string;",
    "string; let x = 1",
    "string\n;let x = 1",
    "A\n;",
    "{ a: string } }",
    "{ a: string } }; let x: {",
    "}; type U = {",
    "string */",
    "string /*",
    "string */ let x = 1; /*",
    "string\n// a\nlet x = 1",
  ];
  expect(verdicts(texts)).toEqual(texts.map((text) => [text, false]));
});

test("agrees with parsing `type T = text` on mutated types", () => {
  const disagreements: string[] = [];
  const check = (text: string) => {
    if (isValidType(text) !== asTypeAlias(text)) disagreements.push(text);
  };
  for (const text of VALID) {
    for (let i = 0; i <= text.length; i++) {
      check(text.slice(0, i) + text.slice(i + 1));
      for (const insert of INSERTS) {
        check(text.slice(0, i) + insert + text.slice(i));
      }
    }
  }
  expect(disagreements).toEqual([]);
});

test("inline: rejects a `//` comment that would comment out what follows", () => {
  const texts = [
    "string // the size",
    "A | B // c",
    "string /* a */ // b",
    "string\n// c",
    "{\n  a: string; // first\n  b: number } // last",
  ];
  expect(verdicts(texts, { inline: true })).toEqual(
    texts.map((text) => [text, false]),
  );
  expect(verdicts(texts)).toEqual(texts.map((text) => [text, true]));
});

test("inline: accepts block comments, `//` in strings and `//` ended by a line break", () => {
  const texts = [
    "string /* the size */",
    "/* a */ string",
    '"http://a" | "https://b"',
    "{ a: string; // first\n b: number }",
    "string // c\n",
    "string // c\r",
    "string // c\u2028",
  ];
  expect(verdicts(texts, { inline: true })).toEqual(
    texts.map((text) => [text, true]),
  );
});

test("inline: agrees with also parsing `(text)` on mutated types", () => {
  const disagreements: string[] = [];
  const check = (text: string) => {
    const parenthesized = isValidType(text) && isValidType(`(${text})`);
    if (isValidType(text, { inline: true }) !== parenthesized) {
      disagreements.push(text);
    }
  };
  for (const text of VALID) {
    for (let i = 0; i <= text.length; i++) {
      check(text.slice(0, i) + text.slice(i + 1));
      for (const insert of INSERTS) {
        check(text.slice(0, i) + insert + text.slice(i));
      }
    }
  }
  expect(disagreements).toEqual([]);
});
