import {
  svelte_options_deprecated_tag,
  svelte_options_invalid_attribute,
  svelte_options_invalid_attribute_value,
  svelte_options_invalid_customelement,
  svelte_options_invalid_customelement_props,
  svelte_options_invalid_customelement_shadow,
  svelte_options_invalid_tagname,
  svelte_options_reserved_tagname,
  svelte_options_unknown_attribute,
} from "./errors";
import type { Node } from "./types/estree";
import type { AST } from "./types/svelte-ast";

type Options = AST.SvelteOptions;
type CustomElement = NonNullable<Options["customElement"]>;
type PropConfig = NonNullable<CustomElement["props"]>[string];

const NAMESPACES = new Map<unknown, Options["namespace"]>([
  ["html", "html"],
  ["svg", "svg"],
  ["mathml", "mathml"],
  ["http://www.w3.org/2000/svg", "svg"],
  ["http://www.w3.org/1998/Math/MathML", "mathml"],
]);

const PROP_CHECKS = new Map<string, (value: unknown) => boolean>([
  [
    "type",
    (value) =>
      value === "String" ||
      value === "Number" ||
      value === "Boolean" ||
      value === "Array" ||
      value === "Object",
  ],
  ["reflect", (value) => typeof value === "boolean"],
  ["attribute", (value) => typeof value === "string"],
]);

const NAME_CHAR =
  "[a-z0-9_.\\xB7\\xC0-\\xD6\\xD8-\\xF6\\xF8-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u203F-\\u2040\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\u{10000}-\\u{EFFFF}-]";
const REGEX_CUSTOM_ELEMENT_NAME = new RegExp(
  `^[a-z]${NAME_CHAR}*-${NAME_CHAR}*$`,
  "u",
);
const RESERVED_NAMES = new Set(
  "annotation-xml color-profile font-face font-face-src font-face-uri font-face-format font-face-name missing-glyph".split(
    " ",
  ),
);

const flag =
  (key: "runes" | "immutable" | "preserveWhitespace" | "accessors") =>
  (options: Options, attribute: AST.Attribute) => {
    const value = staticValue(attribute);
    if (typeof value !== "boolean") {
      svelte_options_invalid_attribute_value(attribute, "true or false");
    }
    options[key] = value;
  };

const READERS = new Map<
  string,
  (options: Options, attribute: AST.Attribute) => void
>([
  ["runes", flag("runes")],
  ["immutable", flag("immutable")],
  ["preserveWhitespace", flag("preserveWhitespace")],
  ["accessors", flag("accessors")],
  [
    "namespace",
    (options, attribute) => {
      const namespace = NAMESPACES.get(staticValue(attribute));
      if (!namespace) {
        svelte_options_invalid_attribute_value(
          attribute,
          `"html", "mathml" or "svg"`,
        );
      }
      options.namespace = namespace;
    },
  ],
  [
    "css",
    (options, attribute) => {
      if (staticValue(attribute) !== "injected") {
        svelte_options_invalid_attribute_value(attribute, `"injected"`);
      }
      options.css = "injected";
    },
  ],
  ["tag", (_, attribute) => svelte_options_deprecated_tag(attribute)],
  [
    "customElement",
    (options, attribute) => {
      const customElement = readCustomElement(attribute);
      if (customElement) options.customElement = customElement;
    },
  ],
]);

export function readOptions(node: AST.SvelteOptionsRaw): Options {
  const options: Options = {
    start: node.start,
    end: node.end,
    attributes: node.attributes as AST.Attribute[],
  };
  for (const attribute of node.attributes) {
    if (attribute.type !== "Attribute") {
      svelte_options_invalid_attribute(attribute);
    }
    const read = READERS.get(attribute.name);
    if (!read) svelte_options_unknown_attribute(attribute, attribute.name);
    read(options, attribute);
  }
  return options;
}

/** A value given as text or a literal expression; `true` for a bare attribute, `null` otherwise. */
function staticValue({ value }: AST.Attribute): unknown {
  if (value === true) return true;
  const chunks = Array.isArray(value) ? value : [value];
  if (chunks.length === 0) return true;
  if (chunks.length > 1) return null;
  const [chunk] = chunks;
  if (chunk.type === "Text") return chunk.data;
  return chunk.expression.type === "Literal" ? chunk.expression.value : null;
}

function checkName(node: AST.Attribute | null, name: unknown): void {
  if (typeof name !== "string") svelte_options_invalid_tagname(node);
  if (!name) return;
  if (!REGEX_CUSTOM_ELEMENT_NAME.test(name)) {
    svelte_options_invalid_tagname(node);
  }
  if (RESERVED_NAMES.has(name)) svelte_options_reserved_tagname(node);
}

/** Non-computed `key: value` properties, first occurrence of each key; `fail` on anything else. */
function propertiesOf(object: Node, fail: () => never): Map<string, Node> {
  const properties = new Map<string, Node>();
  for (const property of (object as { properties: Node[] }).properties) {
    if (
      property.type !== "Property" ||
      property.computed ||
      property.key.type !== "Identifier"
    ) {
      fail();
    }
    if (!properties.has(property.key.name)) {
      properties.set(property.key.name, property.value);
    }
  }
  return properties;
}

function readCustomElement(
  attribute: AST.Attribute,
): CustomElement | undefined {
  const fail: () => never = () =>
    svelte_options_invalid_customelement(attribute);
  if (attribute.value === true) fail();
  const chunk = Array.isArray(attribute.value)
    ? attribute.value[0]
    : attribute.value;

  if (chunk.type === "Text") {
    const tag = staticValue(attribute);
    checkName(attribute, tag);
    return { tag: tag as string };
  }

  const { expression } = chunk;
  if (expression.type !== "ObjectExpression") {
    if (expression.type === "Literal" && expression.value === null) return;
    fail();
  }

  const properties = propertiesOf(expression, fail);
  const customElement: CustomElement = {};

  if (properties.has("tag")) {
    const tag = (properties.get("tag") as { value?: unknown }).value;
    checkName(null, tag);
    customElement.tag = tag as string;
  }

  const props = properties.get("props");
  if (props) {
    const failProps: () => never = () =>
      svelte_options_invalid_customelement_props(attribute);
    if (props.type !== "ObjectExpression") failProps();
    customElement.props = {};
    for (const property of (props as { properties: Node[] }).properties) {
      if (
        property.type !== "Property" ||
        property.computed ||
        property.key.type !== "Identifier" ||
        property.value.type !== "ObjectExpression"
      ) {
        failProps();
      }
      const prop: PropConfig = {};
      customElement.props[property.key.name] = prop;
      for (const field of property.value.properties) {
        if (
          field.type !== "Property" ||
          field.computed ||
          field.key.type !== "Identifier" ||
          field.value.type !== "Literal"
        ) {
          failProps();
        }
        const value = field.value.value;
        if (!PROP_CHECKS.get(field.key.name)?.(value)) failProps();
        (prop as Record<string, unknown>)[field.key.name] = value;
      }
    }
  }

  const shadow = properties.get("shadow");
  if (shadow) {
    if (shadow.type === "ObjectExpression") {
      customElement.shadow = shadow as never;
    } else if (
      shadow.type === "Literal" &&
      (shadow.value === "open" || shadow.value === "none")
    ) {
      customElement.shadow = shadow.value;
    } else {
      svelte_options_invalid_customelement_shadow(attribute);
    }
  }

  const extend = properties.get("extend");
  if (extend) customElement.extend = extend as never;

  return customElement;
}
