import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";

const root = join(import.meta.dir, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const version = (name: string) =>
  JSON.parse(read(`node_modules/${name}/package.json`)).version;

const LOC_ONLY = "/** Only with `parse(source, { loc: true })`. */";

function block(source: string, header: string): string {
  const start = source.indexOf(header);
  if (start === -1) throw new Error(`not found: ${header}`);
  let depth = 0;
  for (let i = source.indexOf("{", start); i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) {
      return source.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced: ${header}`);
}

function replaceOnce(text: string, from: string, to: string): string {
  if (!text.includes(from)) throw new Error(`not found: ${from}`);
  return text.replaceAll(from, to);
}

function indexOnce(text: string, search: string): number {
  const index = text.indexOf(search);
  if (index === -1 || text.indexOf(search, index + 1) !== -1) {
    throw new Error(`not found exactly once: ${search}`);
  }
  return index;
}

function patch(text: string, from: string, to: string): string {
  const index = indexOnce(text, from);
  return text.slice(0, index) + to + text.slice(index + from.length);
}

function patchMember(
  text: string,
  header: string,
  from: string,
  to: string,
): string {
  const start = indexOnce(text, `${header} {\n`);
  const end = text.indexOf("\n}", start);
  return (
    text.slice(0, start) +
    patch(text.slice(start, end), from, to) +
    text.slice(end)
  );
}

function addMembers(text: string, header: string, members: string): string {
  const end = text.indexOf("\n}", indexOnce(text, `${header} {\n`));
  return `${text.slice(0, end)}\n${members}${text.slice(end)}`;
}

const TS_IMPORTS = [
  "Decorator",
  "TSAsExpression",
  "TSBindingFields",
  "TSClassFields",
  "TSClassMemberFields",
  "TSDeclaration",
  "TSDeclareFunction",
  "TSDeclareMethod",
  "TSExpression",
  "TSFunctionFields",
  "TSIndexSignature",
  "TSInterfaceDeclaration",
  "TSModuleDeclarationStatement",
  "TSNode",
  "TSNonNullExpression",
  "TSParameterProperty",
  "TSSatisfiesExpression",
  "TSTypeAnnotation",
  "TSTypeAssertion",
  "TSTypeParameterDeclaration",
  "TSTypeParameterInstantiation",
];
const IMPORT_KIND = 'importKind?: "type" | "value";';
const EXPORT_KIND = 'exportKind?: "type" | "value";';

let estree = read("node_modules/@types/estree/index.d.ts");
estree = patch(
  estree,
  "    type: string;\n    loc?: SourceLocation | null | undefined;",
  "    type: string;\n    start: number;\n    end: number;\n    loc?: SourceLocation | null | undefined;",
);
estree = patch(
  estree,
  "export interface Program extends BaseNode {",
  'export interface Program extends Omit<BaseNode, "leadingComments"> {',
);
estree = addMembers(
  estree,
  'export interface Program extends Omit<BaseNode, "leadingComments">',
  '    /** In a component\'s `<script>`, an HTML comment right before the tag becomes `{ type: "Line", value }`, without offsets, as in svelte. */\n    leadingComments?: Array<Comment | { type: "Line"; value: string }> | undefined;',
);
estree = patch(
  estree,
  "export interface BaseFunction extends BaseNode {\n    params: Pattern[];",
  "export interface BaseFunction extends BaseNode, TSFunctionFields {\n    params: Array<Pattern | TSParameterProperty>;",
);
estree = patch(
  estree,
  "export type Declaration = FunctionDeclaration | VariableDeclaration | ClassDeclaration;",
  "export type Declaration = FunctionDeclaration | VariableDeclaration | ClassDeclaration | TSDeclaration;",
);
estree = addMembers(
  estree,
  "export interface VariableDeclaration extends BaseDeclaration",
  "    declare?: boolean;",
);
estree = addMembers(
  estree,
  "export interface VariableDeclarator extends BaseNode",
  "    definite?: boolean;",
);
estree = addMembers(
  estree,
  "export interface ExpressionMap",
  "    TSExpression: TSExpression;",
);
estree = addMembers(
  estree,
  "export interface NodeMap",
  "    ImportAttribute: ImportAttribute;\n    TSNode: TSNode;",
);
estree = addMembers(
  estree,
  "export interface Property extends BaseNode",
  "    decorators?: Decorator[];",
);
estree = patch(
  estree,
  "export interface PropertyDefinition extends BaseNode {",
  "export interface PropertyDefinition extends BaseNode, TSClassMemberFields {",
);
estree = addMembers(
  estree,
  "export interface PropertyDefinition extends BaseNode, TSClassMemberFields",
  "    typeAnnotation?: TSTypeAnnotation;\n    definite?: boolean;",
);
estree = patch(
  estree,
  "    left: Pattern | MemberExpression;",
  "    left: Pattern | MemberExpression | TSAsExpression | TSNonNullExpression | TSSatisfiesExpression | TSTypeAssertion;",
);
for (const header of [
  "export interface BaseCallExpression extends BaseExpression",
  "export interface TaggedTemplateExpression extends BaseExpression",
]) {
  estree = addMembers(
    estree,
    header,
    "    typeArguments?: TSTypeParameterInstantiation;",
  );
}
for (const [from, to] of [
  [
    "export interface Identifier extends BaseNode, BaseExpression, BasePattern {",
    "export interface Identifier extends BaseNode, BaseExpression, BasePattern, TSBindingFields {",
  ],
  [
    "export interface ObjectPattern extends BasePattern {",
    "export interface ObjectPattern extends BasePattern, TSBindingFields {",
  ],
  [
    "export interface ArrayPattern extends BasePattern {",
    "export interface ArrayPattern extends BasePattern, TSBindingFields {",
  ],
  [
    "export interface RestElement extends BasePattern {",
    "export interface RestElement extends BasePattern, TSBindingFields {",
  ],
  [
    "export interface BaseClass extends BaseNode {",
    "export interface BaseClass extends BaseNode, TSClassFields {",
  ],
  [
    "    body: Array<MethodDefinition | PropertyDefinition | StaticBlock>;",
    "    body: Array<MethodDefinition | PropertyDefinition | StaticBlock | TSIndexSignature>;",
  ],
  [
    "export interface MethodDefinition extends BaseNode {",
    "export interface MethodDefinition extends BaseNode, TSClassMemberFields {",
  ],
  [
    "    value: FunctionExpression;",
    "    value: FunctionExpression | TSDeclareMethod;",
  ],
  [
    "    | ExportAllDeclaration;",
    "    | ExportAllDeclaration\n    | TSModuleDeclarationStatement;",
  ],
  [
    "    declaration: MaybeNamedFunctionDeclaration | MaybeNamedClassDeclaration | Expression;",
    "    declaration: MaybeNamedFunctionDeclaration | MaybeNamedClassDeclaration | Expression | TSDeclareFunction | TSInterfaceDeclaration;",
  ],
]) {
  estree = patch(estree, from, to);
}
estree = addMembers(
  estree,
  "export interface MethodDefinition extends BaseNode, TSClassMemberFields",
  "    typeParameters?: TSTypeParameterDeclaration;",
);
estree = addMembers(
  estree,
  "export interface AssignmentPattern extends BasePattern",
  "    decorators?: Decorator[];",
);
for (const header of [
  "export interface ImportDeclaration extends BaseModuleDeclaration",
  "export interface ImportSpecifier extends BaseModuleSpecifier",
]) {
  estree = addMembers(estree, header, `    ${IMPORT_KIND}`);
}
estree = addMembers(
  estree,
  "export interface ImportExpression extends BaseExpression",
  "    /** The import attributes, with `typescript: true`; `options` otherwise. */\n    arguments?: Expression[];",
);
for (const header of [
  "export interface ExportNamedDeclaration extends BaseModuleDeclaration",
  'export interface ExportSpecifier extends Omit<BaseModuleSpecifier, "local">',
  "export interface ExportDefaultDeclaration extends BaseModuleDeclaration",
  "export interface ExportAllDeclaration extends BaseModuleDeclaration",
]) {
  estree = addMembers(estree, header, `    ${EXPORT_KIND}`);
}
const ACORN_TYPESCRIPT_ABSENT = (when: string) =>
  `    /** Absent ${when}, as in acorn-typescript. */\n`;
for (const header of [
  "export interface ImportDeclaration extends BaseModuleDeclaration",
  "export interface ExportNamedDeclaration extends BaseModuleDeclaration",
  "export interface ExportAllDeclaration extends BaseModuleDeclaration",
]) {
  estree = patchMember(
    estree,
    header,
    "    attributes: ImportAttribute[];",
    `${ACORN_TYPESCRIPT_ABSENT("with `typescript: true` unless there's a `with` clause")}    attributes?: ImportAttribute[] | undefined;`,
  );
}
for (const header of [
  "export interface SimpleCallExpression extends BaseCallExpression",
  "export interface MemberExpression extends BaseExpression, BasePattern",
]) {
  estree = patchMember(
    estree,
    header,
    "    optional: boolean;",
    `${ACORN_TYPESCRIPT_ABSENT("in a decorator, and on a call with type arguments")}    optional?: boolean;`,
  );
}
for (const header of [
  "export interface MaybeNamedFunctionDeclaration extends BaseFunction, BaseDeclaration",
  "export interface FunctionExpression extends BaseFunction, BaseExpression",
]) {
  estree = addMembers(estree, header, "    expression: false;");
}
estree = addMembers(
  estree,
  "export interface ArrowFunctionExpression extends BaseExpression, BaseFunction",
  "    id: null;",
);
writeFileSync(
  join(root, "src/types/estree.ts"),
  `// Generated by scripts/generate-types.ts from @types/estree ${version("@types/estree")} (MIT, Copyright (c) Microsoft Corporation), with sveast's offsets and the TypeScript plugin's nodes and fields. Do not edit.
import type { ${TS_IMPORTS.join(", ")} } from "./typescript";

${estree}`,
);

const types = read("node_modules/svelte/types/index.d.ts");
const compiler = block(types, "declare module 'svelte/compiler' {");
const estreeImport = compiler.match(/import type \{([^}]+)\} from 'estree';/);
if (!estreeImport) throw new Error("estree import not found");

let ast = block(compiler, "\texport namespace AST {");
ast = replaceOnce(
  ast,
  "\t\t\tname_loc: SourceLocation;",
  `\t\t\t${LOC_ONLY}\n\t\t\tname_loc?: SourceLocation;`,
);
ast = replaceOnce(
  ast,
  "\t\t\tname_loc: SourceLocation | null;",
  `\t\t\t${LOC_ONLY}\n\t\t\tname_loc?: SourceLocation | null;`,
);
ast = replaceOnce(
  ast,
  "\t\t\tvalue: string;\n\t\t\tstart: number;\n\t\t\tend: number;\n\t\t\tloc: {",
  `\t\t\tvalue: string;\n\t\t\tstart: number;\n\t\t\tend: number;\n\t\t\t${LOC_ONLY}\n\t\t\tloc?: {`,
);
ast = replaceOnce(
  ast,
  "\t\t\tinstance: Script | null;",
  "\t\t\tinstance?: Script;",
);
ast = replaceOnce(
  ast,
  "\t\t\tmodule: Script | null;",
  "\t\t\tmodule?: Script;",
);
ast = replaceOnce(
  ast,
  "\t\t\tcomments: JSComment[];\n\t\t}",
  "\t\t\tcomments: JSComment[];\n\t\t\t/** Always empty, as in svelte. */\n\t\t\tjs: [];\n\t\t}",
);
for (const directive of [
  "AnimateDirective",
  "BindDirective",
  "ClassDirective",
  "LetDirective",
  "UseDirective",
]) {
  const header = `\t\texport interface ${directive} extends BaseAttribute {\n`;
  const start = ast.indexOf(header);
  const end = ast.indexOf("\n\t\t}", start);
  if (start === -1 || end === -1) throw new Error(`not found: ${directive}`);
  ast = `${ast.slice(0, end)}\n\t\t\t/** Parsed for every directive, e.g. \`use:x|y\`; svelte's types declare it only on some. */\n\t\t\tmodifiers: string[];${ast.slice(end)}`;
}
const css = block(compiler, "\tnamespace _CSS {");
const namespace = compiler.match(/\ttype Namespace = [^;]+;/)?.[0];
if (!namespace) throw new Error("Namespace type not found");

const dedent = (text: string) => text.replace(/^\t/gm, "");
const out = join(root, "src/types/svelte-ast.ts");
writeFileSync(
  out,
  `// Generated by scripts/generate-types.ts from svelte ${version("svelte")}'s types (MIT). Do not edit.
import type {${estreeImport[1]}} from "./estree";

${dedent(namespace)}

${dedent(ast).replace(/^export namespace AST/, "export declare namespace AST")}

${dedent(css).replace(/^namespace _CSS/, "declare namespace _CSS")}
`,
);

await $`bunx biome check --write ${join(root, "src/types")}`.quiet();
console.log("✓ src/types/estree.ts and src/types/svelte-ast.ts written");
