import {
  type Identifier,
  type LexedStatement,
  type LexedString,
  type ModuleDeclaration,
  type Program,
  type StringLiteral,
  walk,
} from "../src/index";

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

const IMPORT_SPECIFIERS = {
  ImportDefaultSpecifier: { kind: "default", imported: "default" },
  ImportNamespaceSpecifier: { kind: "namespace", imported: "*" },
  ImportSpecifier: { kind: "named", imported: "" },
} as const;

const nameOf = (node: Identifier | StringLiteral) =>
  node.type === "Identifier" ? node.name : node.value;

/**
 * `lexImportsExports`'s statements in a shape `parseImportsExports`'s nodes
 * map to. An `export *` has no specifier node, so its specifier's offsets
 * are left out.
 */
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
            ...(specifier.kind === "named" && {
              start: specifier.start,
              end: specifier.end,
            }),
          })),
  }));
}

/** What `comparableLexed` should give for `parseImportsExports(source, { localExports: false })`'s nodes. */
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

/** The strings `lexStrings` should return for a module `parseModule` returned: each string `Literal` and each `TemplateElement`, in source order. */
export function expectedStrings(program: Program): LexedString[] {
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
