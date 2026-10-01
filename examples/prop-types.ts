import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import {
  type ExportNamedDeclaration,
  type Expression,
  isValidType,
  type Pattern,
  parse,
} from "sveast";

const JSDOC_LINE_START = /^\s*\*\s?/;
const TYPE_TAG = "\n@type {";

export interface PropType {
  name: string;
  /** From `@type {...}`, a TypeScript annotation, or the default's literal. */
  type: string;
  optional: boolean;
  /** The JSDoc text before its first tag. */
  description: string;
}

export interface PropTypes {
  props: PropType[];
  /** Props whose `@type` isn't one valid type, typed `any` instead. */
  invalid: Array<{ name: string; type: string }>;
}

/**
 * The props a Svelte 4 component declares with `export let`, typed from
 * their JSDoc, as a tool generating `.d.ts` files for a component library
 * would read them. A JSDoc type is copied into TypeScript only if
 * `isValidType` accepts it, so a typo or a comment in it can't break the
 * declaration file or smuggle code into it.
 */
export function propTypes(source: string): PropTypes {
  const result: PropTypes = { props: [], invalid: [] };
  const ast = parse(source, { css: false });
  for (const statement of ast.instance?.content.body ?? []) {
    if (
      statement.type !== "ExportNamedDeclaration" ||
      statement.declaration?.type !== "VariableDeclaration" ||
      statement.declaration.kind !== "let"
    ) {
      continue;
    }
    const { description, type: jsdocType } = jsdoc(statement);
    for (const { id, init } of statement.declaration.declarations) {
      if (id.type !== "Identifier") continue;
      let type = jsdocType ?? annotation(source, id) ?? literalType(init);
      if (!isValidType(type, { inline: true })) {
        result.invalid.push({ name: id.name, type });
        type = "any";
      }
      result.props.push({
        name: id.name,
        type,
        optional: init !== null && init !== undefined,
        description,
      });
    }
  }
  return result;
}

function jsdoc(statement: ExportNamedDeclaration): {
  description: string;
  type?: string;
} {
  const comment = statement.leadingComments?.at(-1);
  if (comment?.type !== "Block" || !comment.value.startsWith("*")) {
    return { description: "" };
  }
  const text = comment.value
    .slice(1)
    .split("\n")
    .map((line) => line.replace(JSDOC_LINE_START, "").trimEnd())
    .join("\n")
    .trim();
  const tag = text.indexOf("\n@");
  const description = (
    text.startsWith("@") ? "" : text.slice(0, tag === -1 ? undefined : tag)
  ).trim();
  return { description, type: typeTag(`\n${text}`) };
}

function typeTag(text: string): string | undefined {
  const start = text.indexOf(TYPE_TAG);
  if (start === -1) return undefined;
  let depth = 1;
  for (let index = start + TYPE_TAG.length; index < text.length; index++) {
    if (text[index] === "{") depth++;
    if (text[index] === "}" && --depth === 0) {
      return text.slice(start + TYPE_TAG.length, index).trim();
    }
  }
  return undefined;
}

function annotation(source: string, id: Pattern): string | undefined {
  const type = id.type === "Identifier" ? id.typeAnnotation : undefined;
  return (
    type && source.slice(type.typeAnnotation.start, type.typeAnnotation.end)
  );
}

function literalType(init: Expression | null | undefined) {
  const kind = init?.type === "Literal" ? typeof init.value : undefined;
  return kind === "string" || kind === "number" || kind === "boolean"
    ? kind
    : "any";
}

/** A `.d.ts` interface for the props, with their descriptions as JSDoc. */
export function declaration(name: string, props: PropType[]): string {
  const members = props.map(({ name: prop, type, optional, description }) => {
    const docs = description.split("\n").filter(Boolean);
    const comment =
      docs.length > 1
        ? `  /**\n${docs.map((line) => `   * ${line}`).join("\n")}\n   */\n`
        : docs.map((line) => `  /** ${line} */\n`).join("");
    return `${comment}  ${prop}${optional ? "?" : ""}: ${type};\n`;
  });
  return `export interface ${name}Props {\n${members.join("")}}\n`;
}

if (import.meta.main) {
  const files = process.argv.slice(2);
  const sources = await Promise.all(
    files.map((file) => readFile(file, "utf8")),
  );
  for (const [index, file] of files.entries()) {
    const { props, invalid } = propTypes(sources[index] ?? "");
    for (const { name, type } of invalid) {
      console.error(`${file}: ${name}'s @type {${type}} isn't one type`);
    }
    console.log(declaration(basename(file, ".svelte"), props));
  }
}
