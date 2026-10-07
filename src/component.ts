import { readElement } from "./elements";
import {
  block_unclosed,
  element_unclosed,
  svelte_meta_invalid_content,
} from "./errors";
import { setSource } from "./locator";
import { withoutByteOrderMark } from "./markup";
import type { ParseOptions } from "./options";
import { readOptions } from "./read-options";
import { TemplateParserState } from "./state";
import type { Support } from "./support";
import { readTag } from "./tag";
import { readText } from "./text";
import type { AST } from "./types/svelte-ast";

export function parseComponent(
  source: string,
  options: ParseOptions | undefined,
  support: Support,
): AST.Root {
  const state = componentState(source, options, support);
  while (state.index < state.source.length) readNode(state);
  return finishComponent(state);
}

export function componentState(
  source: string,
  options: ParseOptions | undefined,
  support: Support,
): TemplateParserState {
  const template = withoutByteOrderMark(source);
  setSource(template);
  return new TemplateParserState(
    template.trimEnd(),
    template.length,
    support,
    options,
  );
}

export function finishComponent(state: TemplateParserState): AST.Root {
  if (state.stack.length > 1) {
    const current = state.current();
    current.end = current.start + 1;
    if (current.type === "RegularElement") {
      element_unclosed(current, current.name);
    }
    block_unclosed(current);
  }

  const { nodes: rootNodes } = state.root.fragment;
  const optionsIndex = rootNodes.findIndex(
    (node) => node.type === "SvelteOptions",
  );
  const raw = rootNodes[optionsIndex];
  if (raw?.type === "SvelteOptions") {
    rootNodes.splice(optionsIndex, 1);
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

export function readNode(state: TemplateParserState): void {
  if (state.match("<")) {
    readElement(state);
  } else if (state.match("{")) {
    readTag(state);
  } else {
    readText(state);
  }
}
