import { readFile } from "node:fs/promises";
import {
  type AST,
  createLocator,
  markupVisitorKeys,
  parse,
  SKIP,
  walk,
} from "sveast";

const WHITESPACE = /\s+/;

export interface UnusedClass {
  name: string;
  /** The line of the selector that declares it. */
  line: number;
}

export interface UnusedClasses {
  /** Each selector's class the markup never uses, in source order. */
  unused: UnusedClass[];
  /**
   * Whether a `class` attribute has an expression, as in `class={size}` or
   * `class="btn {size}"`, so any of `unused` may still be used.
   */
  dynamic: boolean;
}

/**
 * The classes a component's styles declare but its markup never uses, e.g.
 * to report dead CSS. Classes under `:global` don't belong to the component,
 * and those in a pseudo-class's arguments, as in `:not(.active)`, needn't be
 * used, so neither is reported.
 */
export function unusedClasses(source: string): UnusedClasses {
  const ast = parse(source, { script: false });
  const used = new Set<string>();
  let dynamic = false;
  walk(
    ast.fragment,
    {
      enter(node) {
        if (node.type === "ClassDirective") used.add(node.name);
        if (node.type !== "Attribute" || node.name !== "class") return;
        for (const part of node.value === true ? [] : [node.value].flat()) {
          if (part.type === "ExpressionTag") dynamic = true;
          else {
            for (const name of part.data.split(WHITESPACE)) {
              if (name) used.add(name);
            }
          }
        }
      },
    },
    markupVisitorKeys,
  );
  const locate = createLocator(source);
  const unused = declaredClasses(ast)
    .filter(({ name }) => !used.has(name))
    .map(({ name, start }) => ({ name, line: locate(start).line }));
  return { unused, dynamic };
}

function declaredClasses(ast: AST.Root): AST.CSS.ClassSelector[] {
  const declared: AST.CSS.ClassSelector[] = [];
  if (!ast.css) return declared;
  walk(ast.css, {
    enter(node) {
      if (node.type !== "Rule") return;
      let global = false;
      for (const complex of node.prelude.children) {
        for (const { selectors } of complex.children) {
          global ||= selectors.some(isBareGlobal);
          if (global) break;
          for (const selector of selectors) {
            if (selector.type === "ClassSelector") declared.push(selector);
          }
        }
      }
      return global ? SKIP : undefined;
    },
  });
  return declared;
}

const isBareGlobal = (selector: AST.CSS.SimpleSelector): boolean =>
  selector.type === "PseudoClassSelector" &&
  selector.name === "global" &&
  selector.args === null;

if (import.meta.main) {
  const files = process.argv.slice(2);
  const sources = await Promise.all(
    files.map((file) => readFile(file, "utf8")),
  );
  for (const [index, file] of files.entries()) {
    const { unused, dynamic } = unusedClasses(sources[index] ?? "");
    for (const { name, line } of unused) {
      const maybe = dynamic ? " (maybe used by a dynamic class)" : "";
      console.log(`${file}:${line} .${name}${maybe}`);
    }
  }
}
