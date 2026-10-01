import { readFile } from "node:fs/promises";
import {
  type AST,
  type EntityName,
  extractIdentifiers,
  type Identifier,
  isReference,
  parse,
  walk,
} from "sveast";

export interface UnusedBinding {
  name: string;
  line: number;
}

/**
 * The imports, variables, functions and classes a component's `<script>`s
 * declare at the top level but neither the scripts nor the markup use,
 * e.g. an import left behind by a refactor, which a linter that only reads
 * the script would miss or misreport. Props from `$props()` and `export`ed
 * names are the component's API, so they're never reported. A type counts
 * as used when a type annotation names it, which `isReference` leaves out
 * since it only answers for values. Scopes aren't
 * tracked: a parameter or local that shadows a binding counts as a use.
 */
export function unusedBindings(source: string): UnusedBinding[] {
  const ast = parse(source, { css: false, comments: false });
  const declared = topLevelBindings(ast);
  const declarations = new Set(declared);
  const used = new Set<string>();
  const use = (name: string): void => {
    used.add(name);
    if (name.startsWith("$")) used.add(name.slice(1));
  };
  const useType = (name: EntityName): void => {
    let first = name;
    while (first.type === "TSQualifiedName") first = first.left;
    use(first.name);
  };
  walk(ast, {
    enter(node, parent) {
      if (node.type === "Identifier") {
        if (!declarations.has(node) && isReference(node, parent)) {
          use(node.name);
        }
      } else if (node.type === "TSTypeReference") {
        useType(node.typeName);
      } else if (node.type === "TSTypeQuery") {
        if (node.exprName.type !== "TSImportType") useType(node.exprName);
      } else if (node.type === "TSExpressionWithTypeArguments") {
        useType(node.expression);
      } else if (node.type === "Component") {
        use(node.name.split(".")[0] ?? node.name);
      } else if (
        node.type === "UseDirective" ||
        node.type === "TransitionDirective" ||
        node.type === "AnimateDirective"
      ) {
        use(node.name);
      }
    },
  });
  return declared
    .filter(({ name }) => !used.has(name))
    .map(({ name, start }) => ({
      name,
      line: source.slice(0, start).split("\n").length,
    }));
}

function topLevelBindings(ast: AST.Root): Identifier[] {
  const bindings: Identifier[] = [];
  for (const script of [ast.module, ast.instance]) {
    for (const statement of script?.content.body ?? []) {
      if (statement.type === "ImportDeclaration") {
        for (const specifier of statement.specifiers) {
          bindings.push(specifier.local);
        }
      } else if (statement.type === "VariableDeclaration") {
        for (const { id, init } of statement.declarations) {
          const isProps =
            init?.type === "CallExpression" &&
            init.callee.type === "Identifier" &&
            init.callee.name === "$props";
          if (!isProps) bindings.push(...extractIdentifiers(id));
        }
      } else if (
        (statement.type === "FunctionDeclaration" ||
          statement.type === "ClassDeclaration") &&
        statement.id
      ) {
        bindings.push(statement.id);
      }
    }
  }
  return bindings;
}

if (import.meta.main) {
  const files = process.argv.slice(2);
  const sources = await Promise.all(
    files.map((file) => readFile(file, "utf8")),
  );
  for (const [index, file] of files.entries()) {
    for (const { name, line } of unusedBindings(sources[index] ?? "")) {
      console.log(`${file}:${line} ${name}`);
    }
  }
}
