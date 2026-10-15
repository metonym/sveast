import { readFileSync } from "node:fs";
import {
  type Identifier,
  type LexedDynamicImport,
  type LexedStatement,
  type LexedString,
  type ModuleDeclaration,
  type Node,
  parse,
  parseModule,
  type StringLiteral,
  walk,
} from "../src/index";
import { attempt } from "./shared";

export interface Module {
  text: string;
  typescript: boolean;
}

interface Comparable {
  kind: "import" | "export";
  start: number;
  end: number;
  source: { value: string; start: number; end: number } | null;
  typeOnly: boolean;
  specifiers: {
    kind: string;
    names: [string, string | null];
    typeOnly: boolean;
    start?: number;
    end?: number;
  }[];
}

export const MODULE_FILES = /\.(?:[cm]?ts|[cm]?js|svelte)$/;
const TS_FILE = /\.[cm]?ts$/;
const LANG_TS = /\blang=["']?ts\b/;

const MODULE_TYPES = new Set([
  "ImportDeclaration",
  "ExportNamedDeclaration",
  "ExportDefaultDeclaration",
  "ExportAllDeclaration",
  "TSImportEqualsDeclaration",
  "TSExportAssignment",
  "TSNamespaceExportDeclaration",
]);

const IMPORT_SPECIFIERS = {
  ImportDefaultSpecifier: { kind: "default", imported: "default" },
  ImportNamespaceSpecifier: { kind: "namespace", imported: "*" },
  ImportSpecifier: { kind: "named", imported: "" },
} as const;

const nameOf = (node: Identifier | StringLiteral) =>
  node.type === "Identifier" ? node.name : node.value;

function componentScripts(source: string): Module[] {
  const ast = attempt(() => parse(source, { script: false }));
  return [ast?.instance, ast?.module].flatMap((script) =>
    script
      ? [
          {
            text: source.slice(script.content.start, script.content.end),
            typescript: LANG_TS.test(
              source.slice(script.start, script.content.start),
            ),
          },
        ]
      : [],
  );
}

export function modulesIn(file: string): Module[] {
  const source = readFileSync(file, "utf8");
  return file.endsWith(".svelte")
    ? componentScripts(source)
    : [{ text: source, typescript: TS_FILE.test(file) }];
}

function isImportOrReexport(node: Node): boolean {
  return node.type === "ExportNamedDeclaration"
    ? node.source !== null && node.source !== undefined
    : node.type === "ImportDeclaration" ||
        node.type === "ExportAllDeclaration" ||
        node.type === "TSImportEqualsDeclaration";
}

export function expectedImportsExports(
  body: Node[],
  localExports: boolean,
): ModuleDeclaration[] {
  return body.filter(
    (node): node is ModuleDeclaration =>
      MODULE_TYPES.has(node.type) && (localExports || isImportOrReexport(node)),
  );
}

/** What `lexImportsExports` returns with `exportLists`: imports, re-exports and `export { … }`. */
export function withExportLists(
  nodes: ModuleDeclaration[],
): ModuleDeclaration[] {
  return nodes.filter(
    (node) =>
      isImportOrReexport(node) ||
      (node.type === "ExportNamedDeclaration" && !node.declaration),
  );
}

export function comparableLexed(statements: LexedStatement[]): Comparable[] {
  return statements.map((statement) => ({
    kind: statement.kind,
    start: statement.start,
    end: statement.end,
    source: statement.source && { ...statement.source },
    typeOnly: statement.typeOnly,
    specifiers:
      statement.kind === "import"
        ? statement.specifiers.map((specifier) => ({
            kind: specifier.kind,
            names: [specifier.imported, specifier.local],
            typeOnly: specifier.typeOnly,
            start: specifier.start,
            end: specifier.end,
          }))
        : statement.specifiers.map((specifier) => ({
            kind: specifier.kind,
            names: [specifier.local, specifier.exported],
            typeOnly: specifier.typeOnly,
            ...((specifier.kind === "named" || specifier.kind === "local") && {
              start: specifier.start,
              end: specifier.end,
            }),
          })),
  }));
}

export function expectedLexed(nodes: ModuleDeclaration[]): Comparable[] {
  return nodes.map((node) => {
    if (node.type === "TSImportEqualsDeclaration") {
      return {
        kind: node.isExport ? "export" : "import",
        start: node.start,
        end: node.end,
        source: null,
        typeOnly: node.importKind === "type",
        specifiers: [],
      };
    }
    if (node.type === "ImportDeclaration") {
      const typeOnly = node.importKind === "type";
      return {
        kind: "import",
        start: node.start,
        end: node.end,
        source: {
          value: node.source.value,
          start: node.source.start,
          end: node.source.end,
        },
        typeOnly,
        specifiers: node.specifiers.map((specifier) => ({
          kind: IMPORT_SPECIFIERS[specifier.type].kind,
          names: [
            specifier.type === "ImportSpecifier"
              ? nameOf(specifier.imported)
              : IMPORT_SPECIFIERS[specifier.type].imported,
            specifier.local.name,
          ],
          typeOnly:
            typeOnly ||
            (specifier.type === "ImportSpecifier" &&
              specifier.importKind === "type"),
          start: specifier.start,
          end: specifier.end,
        })),
      };
    }
    if (
      node.type === "ExportNamedDeclaration" &&
      !node.source &&
      !node.declaration
    ) {
      const typeOnly = node.exportKind === "type";
      return {
        kind: "export",
        start: node.start,
        end: node.end,
        source: null,
        typeOnly,
        specifiers: node.specifiers.map((specifier) => ({
          kind: "local",
          names: [nameOf(specifier.local), nameOf(specifier.exported)],
          typeOnly: typeOnly || specifier.exportKind === "type",
          start: specifier.start,
          end: specifier.end,
        })),
      };
    }
    if (
      (node.type !== "ExportNamedDeclaration" &&
        node.type !== "ExportAllDeclaration") ||
      !node.source
    ) {
      throw new Error(`${node.type} at ${node.start} isn't a re-export`);
    }
    const typeOnly = node.exportKind === "type";
    return {
      kind: "export",
      start: node.start,
      end: node.end,
      source: {
        value: node.source.value,
        start: node.source.start,
        end: node.source.end,
      },
      typeOnly,
      specifiers:
        node.type === "ExportAllDeclaration"
          ? [
              {
                kind: node.exported ? "namespace" : "all",
                names: ["*", node.exported ? nameOf(node.exported) : null],
                typeOnly,
              },
            ]
          : node.specifiers.map((specifier) => ({
              kind: "named",
              names: [nameOf(specifier.local), nameOf(specifier.exported)],
              typeOnly: typeOnly || specifier.exportKind === "type",
              start: specifier.start,
              end: specifier.end,
            })),
    };
  });
}

export function expectedStrings(
  source: string,
  typescript: boolean,
): LexedString[] | undefined {
  const program = attempt(() =>
    parseModule(source, { typescript, comments: false }),
  );
  if (!program) return;
  const strings: LexedString[] = [];
  walk(program, {
    enter(node) {
      if (node.type === "Literal" && typeof node.value === "string") {
        strings.push({
          kind: "string",
          value: node.value,
          start: node.start,
          end: node.end,
        });
      } else if (node.type === "TemplateElement") {
        strings.push({
          kind: "template",
          value: node.value.cooked ?? null,
          start: node.start,
          end: node.end,
        });
      }
    },
  });
  return strings.sort((a, b) => a.start - b.start);
}

function literalSource(node: Node | undefined): LexedDynamicImport["source"] {
  if (node?.type === "Literal" && typeof node.value === "string") {
    return { value: node.value, start: node.start, end: node.end };
  }
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0) {
    const value = node.quasis[0].value.cooked;
    return value == null ? null : { value, start: node.start, end: node.end };
  }
  return null;
}

function isGlob(callee: Node): boolean {
  return (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    !callee.optional &&
    callee.object.type === "MetaProperty" &&
    callee.object.meta.name === "import" &&
    callee.property.type === "Identifier" &&
    callee.property.name === "glob"
  );
}

export function expectedDynamicImports(
  source: string,
  typescript: boolean,
): LexedDynamicImport[] | undefined {
  const program = attempt(() =>
    parseModule(source, { typescript, comments: false }),
  );
  if (!program) return;
  const imports: LexedDynamicImport[] = [];
  walk(program, {
    enter(node) {
      if (node.type === "ImportExpression") {
        imports.push({
          kind: "import",
          source: literalSource(node.source),
          start: node.start,
          end: node.end,
        });
      } else if (
        node.type === "CallExpression" ||
        node.type === "NewExpression"
      ) {
        const { callee } = node;
        const parenthesized =
          node.type === "CallExpression"
            ? callee.start !== node.start
            : source.slice(node.start, callee.start).trim() !== "new";
        if (
          parenthesized ||
          (node.type === "CallExpression" && node.optional)
        ) {
          return;
        }
        let kind: LexedDynamicImport["kind"];
        if (callee.type === "Identifier" && callee.name === "require") {
          kind = "require";
        } else if (node.type === "CallExpression" && isGlob(callee)) {
          kind = "glob";
        } else {
          return;
        }
        const argument = node.arguments[0] as Node | undefined;
        imports.push({
          kind,
          source:
            argument?.type === "SpreadElement" ? null : literalSource(argument),
          start: callee.start,
          end: node.end,
        });
      } else if (node.type === "TSImportType") {
        const argument = node.argument as Node;
        imports.push({
          kind: "import",
          source: literalSource(argument),
          start: node.start,
          end: source.indexOf(")", argument.end) + 1,
        });
      } else if (node.type === "TSExternalModuleReference") {
        imports.push({
          kind: "require",
          source: literalSource(node.expression as Node),
          start: node.start,
          end: node.end,
        });
      }
    },
  });
  return imports.sort((a, b) => a.start - b.start);
}
