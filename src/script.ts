import { parseProgram } from "./acorn-bridge";
import {
  element_unclosed,
  script_invalid_attribute_value,
  script_invalid_context,
  script_reserved_attribute,
  unexpected_eof,
} from "./errors";
import { position } from "./locator";
import { closingScriptTag, closingScriptTagEnd } from "./markup";
import type { TemplateParserState } from "./state";
import type { Program } from "./types/estree";
import type { AST } from "./types/svelte-ast";

const RESERVED_ATTRIBUTES = new Set([
  "server",
  "client",
  "worker",
  "test",
  "default",
]);

export function readScript(
  state: TemplateParserState,
  start: number,
  attributes: AST.Attribute[],
): AST.Script {
  const source = state.source;
  const scriptStart = state.index;
  if (scriptStart >= source.length) unexpected_eof(source.length);
  const close = closingScriptTag(source, scriptStart);
  if (close === -1) element_unclosed(source.length, "script");
  state.index = closingScriptTagEnd(source, close);

  const program: Program = state.script
    ? parseProgram(state, source.slice(0, close), scriptStart)
    : {
        type: "Program",
        start: scriptStart,
        end: close,
        body: [],
        sourceType: "module",
      };
  program.start = scriptStart;
  if (program.loc) {
    Object.assign(program.loc.start, position(start));
    Object.assign(program.loc.end, position(state.index));
  } else if (state.loc) {
    program.loc = { start: position(start), end: position(state.index) };
  }

  let context: "default" | "module" = "default";

  for (const attribute of attributes) {
    if (RESERVED_ATTRIBUTES.has(attribute.name)) {
      script_reserved_attribute(attribute, attribute.name);
    }

    if (attribute.name === "module") {
      if (attribute.value !== true) {
        script_invalid_attribute_value(attribute, attribute.name);
      }
      context = "module";
    }

    if (attribute.name === "context") {
      const value = attribute.value;
      if (
        !Array.isArray(value) ||
        value.length !== 1 ||
        value[0].type !== "Text" ||
        value[0].data !== "module"
      ) {
        script_invalid_context(attribute);
      }
      context = "module";
    }
  }

  return {
    type: "Script",
    start,
    end: state.index,
    context,
    content: program,
    attributes,
  };
}
