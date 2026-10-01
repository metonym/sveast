import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "@typescript/typescript6";
import { parse, parseModule } from "sveast";
import { byCodeUnit } from "../scripts/shared";
import { SNIPPETS } from "./ts-snippets";

interface Shape {
  name: string;
  keys: Set<string>;
  required: string[];
}

const COMMENTS = new Set(["comments", "leadingComments", "trailingComments"]);

function declaredShapes(): Map<string, Shape[]> {
  const file = join(import.meta.dir, "../src/types/svelte-ast.ts");
  const program = ts.createProgram([file], {
    strict: true,
    noEmit: true,
    types: [],
  });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(file);
  const moduleSymbol = source && checker.getSymbolAtLocation(source);
  const ast = moduleSymbol && checker.getExportsOfModule(moduleSymbol)[0];
  const svelteNode = ast && checker.getExportsOfModule(ast);
  const symbol = svelteNode?.find((s) => s.name === "SvelteNode");
  if (!symbol) throw new Error("AST.SvelteNode not found");

  const shapes = new Map<string, Shape[]>();
  const union = checker.getDeclaredTypeOfSymbol(symbol);
  for (const member of union.isUnion() ? union.types : [union]) {
    const typeProperty = member.getProperty("type");
    if (!typeProperty) continue;
    const typeOfType = checker.getTypeOfSymbol(typeProperty);
    const properties = member.getProperties();
    const shape: Shape = {
      name: checker.typeToString(member),
      keys: new Set(properties.map((p) => p.name)),
      required: properties
        .filter((p) => !(p.flags & ts.SymbolFlags.Optional))
        .map((p) => p.name),
    };
    for (const literal of typeOfType.isUnion()
      ? typeOfType.types
      : [typeOfType]) {
      if (!literal.isStringLiteral()) continue;
      const list = shapes.get(literal.value) ?? [];
      list.push(shape);
      shapes.set(literal.value, list);
    }
  }
  return shapes;
}

const SHAPES = declaredShapes();

function mismatches(root: unknown): string[] {
  const found = new Set<string>();
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (value === null || typeof value !== "object") return;
    const node = value as Record<string, unknown>;
    if (typeof node.type === "string") {
      const candidates = SHAPES.get(node.type);
      const keys = Object.keys(node);
      if (!candidates) {
        found.add(`${node.type}: not declared`);
      } else if (
        !candidates.some(
          (shape) =>
            keys.every((key) => shape.keys.has(key)) &&
            shape.required.every((key) => key in node),
        )
      ) {
        const [shape] = candidates;
        const extra = keys.filter((key) => !shape.keys.has(key));
        const missing = shape.required.filter((key) => !(key in node));
        found.add(
          `${node.type} (${shape.name}): undeclared [${extra}], missing [${missing}]`,
        );
      }
    }
    for (const key in node) {
      if (COMMENTS.has(key)) {
        const comments = node[key] as { start?: unknown; end?: unknown }[];
        const withoutOffsets = comments.some(
          (comment) =>
            typeof comment.start !== "number" ||
            typeof comment.end !== "number",
        );
        if (withoutOffsets && node.type !== "Program") {
          found.add(`${node.type}.${key}: a comment without start/end`);
        }
      } else if (key !== "customElement") {
        visit(node[key]);
      }
    }
  };
  visit(root);
  return [...found];
}

const STRING_LITERAL_FIELDS: Record<string, string[]> = {
  ImportDeclaration: ["source"],
  ImportSpecifier: ["imported"],
  ImportAttribute: ["key", "value"],
  ExportNamedDeclaration: ["source"],
  ExportSpecifier: ["local", "exported"],
  ExportAllDeclaration: ["exported", "source"],
  TSImportType: ["argument"],
  TSEnumMember: ["id"],
  TSModuleDeclaration: ["id"],
  TSExternalModuleReference: ["expression"],
};

function nonStringLiterals(root: unknown, seen: Set<string>): string[] {
  const found = new Set<string>();
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (value === null || typeof value !== "object") return;
    const node = value as Record<string, unknown>;
    const type = String(node.type);
    for (const field of STRING_LITERAL_FIELDS[type] ?? []) {
      seen.add(type);
      const child = node[field] as { type?: unknown; value?: unknown } | null;
      if (child?.type === "Literal" && typeof child.value !== "string") {
        found.add(`${type}.${field}`);
      }
    }
    for (const key in node) visit(node[key]);
  };
  visit(root);
  return [...found];
}

const CORPUS = join(import.meta.dir, "corpus");
const FILES = readdirSync(CORPUS, { recursive: true, encoding: "utf8" }).sort();

test("the types declare every node and field the corpus's ASTs have", () => {
  const found = new Set<string>();
  const check = (root: unknown) => {
    for (const mismatch of mismatches(root)) found.add(mismatch);
  };
  for (const path of FILES) {
    const source = () => readFileSync(join(CORPUS, path), "utf8");
    try {
      if (path.endsWith(".svelte")) {
        check(parse(source(), { loc: true }));
        check(parse(source()));
      } else if (path.endsWith(".js") || path.endsWith(".ts")) {
        check(parseModule(source(), { typescript: path.endsWith(".ts") }));
      }
    } catch {
      // files neither parser accepts have no AST to check
    }
  }
  for (const snippet of Object.values(SNIPPETS)) {
    check(parseModule(snippet, { typescript: true, loc: true }));
  }
  expect([...found].sort(byCodeUnit)).toEqual([]);
});

test("the fields typed StringLiteral hold only string literals", () => {
  const found = new Set<string>();
  const seen = new Set<string>();
  const check = (root: unknown) => {
    for (const mismatch of nonStringLiterals(root, seen)) found.add(mismatch);
  };
  for (const path of FILES) {
    const source = () => readFileSync(join(CORPUS, path), "utf8");
    try {
      if (path.endsWith(".svelte")) {
        check(parse(source()));
      } else if (path.endsWith(".js") || path.endsWith(".ts")) {
        check(parseModule(source(), { typescript: path.endsWith(".ts") }));
      }
    } catch {
      // files neither parser accepts have no AST to check
    }
  }
  for (const snippet of Object.values(SNIPPETS)) {
    check(parseModule(snippet, { typescript: true }));
  }
  expect([...found].sort(byCodeUnit)).toEqual([]);
  expect([...seen].sort(byCodeUnit)).toEqual(
    Object.keys(STRING_LITERAL_FIELDS).sort(byCodeUnit),
  );
});
