import { readElement } from "./elements";
import {
  block_unclosed,
  element_unclosed,
  svelte_meta_invalid_content,
} from "./errors";
import { setSource } from "./locator";
import { readOptions } from "./read-options";
import { type ParseOptions, TemplateParserState } from "./state";
import { readTag } from "./tag";
import { readText } from "./text";
import type { AST } from "./types/svelte-ast";

/**
 * Parses a Svelte component into svelte's modern AST, the same as
 * `parse(source, { modern: true })` from svelte/compiler. From svelte's
 * `Parser` constructor (`phases/1-parse/index.js`).
 *
 * Throws a {@link ParseError} on a syntax error.
 */
export function parse(source: string, options?: ParseOptions): AST.Root {
  const template = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  setSource(template);

  const state = new TemplateParserState(
    template.trimEnd(),
    template.length,
    options,
  );

  while (state.index < state.source.length) {
    if (state.match("<")) {
      readElement(state);
    } else if (state.match("{")) {
      readTag(state);
    } else {
      readText(state);
    }
  }

  if (state.stack.length > 1) {
    const current = state.current();
    current.end = current.start + 1;
    if (current.type === "RegularElement") {
      element_unclosed(current, current.name);
    }
    block_unclosed(current);
  }

  const optionsIndex = state.root.fragment.nodes.findIndex(
    (node) => node.type === "SvelteOptions",
  );
  if (optionsIndex !== -1) {
    const [node] = state.root.fragment.nodes.splice(optionsIndex, 1);
    const raw = node as AST.SvelteOptionsRaw;
    state.root.options = readOptions(raw);
    const { nodes } = raw.fragment;
    if (nodes.length > 0) {
      svelte_meta_invalid_content(
        { start: nodes[0].start, end: nodes[nodes.length - 1].end },
        raw.name,
      );
    }
  }

  return state.root;
}
