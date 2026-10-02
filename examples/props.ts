import { readFile } from "node:fs/promises";
import {
  type Expression,
  type Pattern,
  type PrivateIdentifier,
  parse,
} from "sveast";

export interface Prop {
  name: string;
  /** The default value's source text, as in `size = "md"`. */
  default?: string;
}

export interface Props {
  props: Prop[];
  /** The name that collects the rest, as in `...rest` or `let props = $props()`. */
  rest?: string;
}

/**
 * The props a runes component declares with `$props()`, or `undefined` when
 * it doesn't call `$props()`.
 */
export function propsOf(source: string): Props | undefined {
  const script = parse(source, { css: false }).instance;
  for (const statement of script?.content.body ?? []) {
    if (statement.type !== "VariableDeclaration") continue;
    for (const { id, init } of statement.declarations) {
      const isProps =
        init?.type === "CallExpression" &&
        init.callee.type === "Identifier" &&
        init.callee.name === "$props";
      if (isProps) return fromPattern(source, id);
    }
  }
  return undefined;
}

function fromPattern(source: string, id: Pattern): Props {
  if (id.type === "Identifier") return { props: [], rest: id.name };
  const result: Props = { props: [] };
  if (id.type !== "ObjectPattern") return result;
  for (const property of id.properties) {
    if (property.type === "RestElement") {
      if (property.argument.type === "Identifier") {
        result.rest = property.argument.name;
      }
      continue;
    }
    const { key, value } = property;
    const name = property.computed ? undefined : keyName(key);
    if (name === undefined) continue;
    const prop: Prop = { name };
    if (value.type === "AssignmentPattern") {
      prop.default = source.slice(value.right.start, value.right.end);
    }
    result.props.push(prop);
  }
  return result;
}

function keyName(key: Expression | PrivateIdentifier): string | undefined {
  if (key.type === "Identifier") return key.name;
  if (key.type === "Literal" && typeof key.value === "string") return key.value;
  return undefined;
}

if (import.meta.main) {
  const files = process.argv.slice(2);
  const sources = await Promise.all(
    files.map((file) => readFile(file, "utf8")),
  );
  for (const [index, file] of files.entries()) {
    const props = propsOf(sources[index] ?? "");
    if (!props) continue;
    const names = props.props.map((prop) =>
      prop.default === undefined ? prop.name : `${prop.name} = ${prop.default}`,
    );
    if (props.rest !== undefined) names.push(`...${props.rest}`);
    console.log(`${file}: ${names.join(", ")}`);
  }
}
