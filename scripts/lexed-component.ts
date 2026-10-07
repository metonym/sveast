import { createParser } from "../src/core";
import {
  type AST,
  type LexedAttribute,
  type LexedComponent,
  ParseError,
  parse,
} from "../src/index";
import { attempt } from "./shared";

const javascriptOnly = createParser();

function attributesOf(
  source: string,
  attributes: AST.SvelteOptions["attributes"],
): LexedAttribute[] {
  return attributes.flatMap((attribute) => {
    if (attribute.type !== "Attribute") return [];
    const { value } = attribute;
    const chunks = value === true ? [] : [value].flat();
    return [
      {
        name: attribute.name,
        value:
          value === true
            ? true
            : source.slice(chunks[0].start, chunks[chunks.length - 1].end),
        start: attribute.start,
        end: attribute.end,
      },
    ];
  });
}

function scriptOf(
  source: string,
  script: AST.Script | undefined,
): LexedComponent["instance"] {
  if (!script) return null;
  return {
    start: script.start,
    end: script.end,
    context: script.context === "module" ? "module" : "default",
    attributes: attributesOf(source, script.attributes),
    content: { start: script.content.start, end: script.content.end },
  };
}

function isTypeScript(source: string): boolean {
  try {
    javascriptOnly.parse(source, { css: false, script: false });
    return false;
  } catch (error) {
    return !(error instanceof ParseError);
  }
}

export function expectedSections(source: string): LexedComponent | undefined {
  const ast = attempt(() =>
    parse(source, { css: false, script: false, comments: false }),
  );
  if (!ast) return;
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  return {
    typescript: isTypeScript(source),
    instance: scriptOf(text, ast.instance),
    module: scriptOf(text, ast.module),
    css: ast.css && {
      start: ast.css.start,
      end: ast.css.end,
      attributes: attributesOf(text, ast.css.attributes),
      content: { start: ast.css.content.start, end: ast.css.content.end },
    },
    options: ast.options && {
      start: ast.options.start,
      end: ast.options.end,
      attributes: attributesOf(text, ast.options.attributes),
    },
  };
}

export function withoutMarkup(ast: AST.Root): AST.Root {
  const scripts = [ast.instance, ast.module].flatMap((script) =>
    script ? [script.content] : [],
  );
  const comments = ast.comments.filter((comment) =>
    scripts.some(
      ({ start, end }) => comment.start >= start && comment.end <= end,
    ),
  );
  return { ...ast, fragment: { ...ast.fragment, nodes: [] }, comments };
}
