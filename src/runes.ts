import {
  type LexedAttribute,
  type LexedContent,
  lexComponent,
} from "./component-lexer";
import { extractIdentifiers } from "./extract-identifiers";
import { isReference } from "./is-reference";
import { isWhitespace } from "./markup";
import { parse } from "./parse";
import { parseSections } from "./parse-sections";
import { closingBracket, isWordCode } from "./scan";
import type {
  ArrowFunctionExpression,
  Expression,
  FunctionDeclaration,
  FunctionExpression,
  Identifier,
  Node,
  Program,
  Super,
} from "./types/estree";
import type { AST } from "./types/svelte-ast";
import { SKIP, walk } from "./walk";

const RUNES = new Set([
  "$state",
  "$state.raw",
  "$derived",
  "$derived.by",
  "$state.eager",
  "$state.snapshot",
  "$props",
  "$props.id",
  "$bindable",
  "$effect",
  "$effect.pre",
  "$effect.tracking",
  "$effect.root",
  "$effect.pending",
  "$inspect",
  "$inspect().with",
  "$inspect.trace",
  "$host",
]);

const RUNE_NAMES = new Set([
  "$state",
  "$derived",
  "$props",
  "$bindable",
  "$effect",
  "$inspect",
  "$host",
]);

const REGEX_CANDIDATE =
  /(?<![\w$])(?:\$(?:state|derived|props|bindable|effect|inspect|host)(?![\w$])|await(?![\w$]))|\\u/g;

const BOOLEAN_EXPRESSION = /^\{\s*(true|false)\s*\}$/;

type Initial = Node | null;

/**
 * Whether svelte compiles the component in runes mode, as
 * `compile(source).metadata.runes` says: `<svelte:options runes>` if it
 * has one, otherwise whether it uses a rune, such as `$state` or
 * `$props`, or `await` outside a function in its instance script or
 * markup. A `$state` that subscribes to a store named `state` isn't a
 * rune, as in svelte.
 *
 * It reads `<svelte:options>` without parsing, and a component that has
 * no rune's name and no `await` isn't parsed either. Otherwise it parses
 * the scripts, and the markup only if one of them is in it, and throws a
 * `ParseError` on a syntax error there.
 */
export function isRunesMode(source: string): boolean {
  const lexed = lexComponent(source);
  const option = lexed.options?.attributes.find(
    (attribute) => attribute.name === "runes",
  );
  const fromOption = option && booleanValue(option);
  if (fromOption !== undefined) return fromOption;

  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const scripts = [lexed.instance, lexed.module].flatMap((script) =>
    script ? [script.content] : [],
  );
  let candidates = false;
  let inMarkup = false;
  REGEX_CANDIDATE.lastIndex = 0;
  for (
    let match = REGEX_CANDIDATE.exec(text);
    match !== null && !inMarkup;
    match = REGEX_CANDIDATE.exec(text)
  ) {
    const at = match.index;
    candidates = true;
    inMarkup = !scripts.some(({ start, end }) => at >= start && at < end);
  }
  if (!candidates) return false;
  if (
    option === undefined &&
    !text.includes("\\u") &&
    callsRune(text, scripts)
  ) {
    return true;
  }

  const options = { css: false, comments: false };
  const ast = inMarkup
    ? parse(source, options)
    : parseSections(source, options);
  if (ast.options?.runes !== undefined) return ast.options.runes;
  return usesRunes(ast);
}

function booleanValue(attribute: LexedAttribute): boolean | undefined {
  if (attribute.value === true) return true;
  const match = BOOLEAN_EXPRESSION.exec(attribute.value);
  return match ? match[1] === "true" : undefined;
}

const STORE_NAMES = new Map(
  [...RUNE_NAMES].map((name) => [
    name,
    new RegExp(`(?<![\\w$.])${name.slice(1)}(?![\\w$])`),
  ]),
);

const DECLARING_WORDS = new Set(
  "abstract accessor as async class const declare enum export extends function get implements import infer interface is keyof let module namespace new override private protected public readonly satisfies set static type typeof unique var".split(
    " ",
  ),
);

/**
 * Whether a script calls a rune, read without parsing: only when every
 * use of that rune's name in the scripts is a call that can't be a
 * declaration, a method or a type, so no binding shadows it, and its
 * store's name, such as `state` for `$state`, is never written, so it
 * can't be a store subscription.
 */
function callsRune(source: string, scripts: LexedContent[]): boolean {
  const calls = new Map<string, boolean>();
  for (const { start, end } of scripts) {
    const script = source.slice(0, end);
    const stopped = closingBracket(script, start, (wordStart, wordEnd) => {
      if (script.charCodeAt(wordStart) !== 36) return false;
      const name = script.slice(wordStart, wordEnd);
      if (RUNE_NAMES.has(name) && calls.get(name) !== false) {
        calls.set(name, isRuneCall(script, wordStart, wordEnd));
      }
      return false;
    });
    if (stopped !== script.length) return false;
  }
  for (const [name, call] of calls) {
    if (call && !STORE_NAMES.get(name)?.test(source)) return true;
  }
  return false;
}

function isRuneCall(source: string, start: number, end: number): boolean {
  let before = start - 1;
  while (before >= 0 && isWhitespace(source.charCodeAt(before))) before--;
  const previous = source.charCodeAt(before);
  if (
    previous === 35 ||
    previous === 42 ||
    previous === 46 ||
    previous === 58 ||
    previous === 60 ||
    previous === 64
  ) {
    return false;
  }
  if (isWordCode(previous)) {
    let wordStart = before;
    while (wordStart > 0 && isWordCode(source.charCodeAt(wordStart - 1))) {
      wordStart--;
    }
    if (DECLARING_WORDS.has(source.slice(wordStart, before + 1))) return false;
  }

  let i = skipSpace(source, end);
  while (source.charCodeAt(i) === 46) {
    const wordStart = skipSpace(source, i + 1);
    let wordEnd = wordStart;
    while (isWordCode(source.charCodeAt(wordEnd))) wordEnd++;
    if (wordEnd === wordStart) return false;
    i = skipSpace(source, wordEnd);
  }
  if (source.charCodeAt(i) === 60) {
    i = typeArgumentsEnd(source, i);
    if (i === -1) return false;
    i = skipSpace(source, i);
  }
  if (source.charCodeAt(i) !== 40) return false;
  const close = closingBracket(source, i + 1);
  if (source.charCodeAt(close) !== 41) return false;
  const next = source.charCodeAt(skipSpace(source, close + 1));
  return next !== 123 && next !== 58;
}

function skipSpace(source: string, from: number): number {
  let i = from;
  while (i < source.length && isWhitespace(source.charCodeAt(i))) i++;
  return i;
}

/** The offset after the `>` that closes the `<` at `from`, or -1 if it isn't found nearby or a string gets in the way. */
function typeArgumentsEnd(source: string, from: number): number {
  let depth = 0;
  const limit = Math.min(source.length, from + 2000);
  for (let i = from; i < limit; i++) {
    const code = source.charCodeAt(i);
    if (code === 34 || code === 39 || code === 96 || code === 47) return -1;
    if (code === 60) depth++;
    else if (code === 62 && source.charCodeAt(i - 1) !== 61) {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

function usesRunes(ast: AST.Root): boolean {
  const module = ast.module?.content;
  const instance = ast.instance?.content;
  const declared = new Map<string, Initial>();
  if (instance) declare(instance, declared, true);
  const moduleDeclared = new Map<string, Initial>();
  if (module) declare(module, moduleDeclared, false);
  for (const [name, initial] of moduleDeclared) {
    if (!declared.has(name)) declared.set(name, initial);
  }

  const referenced: string[] = [];
  const reference = (name: string) => {
    if (!referenced.includes(name)) referenced.push(name);
  };
  if (module) collectReferences(module, moduleDeclared, reference);
  if (instance && collectReferences(instance, declared, reference)) {
    return true;
  }
  if (collectReferences(ast.fragment, declared, reference)) return true;

  for (const name of referenced) {
    const store = name.slice(1);
    if (!declared.has(store)) return true;
    const initial = declared.get(store) ?? null;
    const rune = runeOf(initial, declared);
    const subscribes =
      (rune === null || (store !== "props" && rune === "$props")) &&
      !(
        name === "$derived" &&
        initial?.type === "ImportDeclaration" &&
        initial.source.value === "svelte/store"
      );
    if (!subscribes) return true;
    declared.set(name, null);
  }
  return false;
}

/**
 * Calls `reference` with each rune's name under `root` that svelte's
 * scopes leave unresolved, so that it reaches the component's scope, and
 * returns whether `root` has an `await` outside a function. `outer` holds
 * the names declared around `root`.
 */
function collectReferences(
  root: AST.SvelteNode,
  outer: ReadonlyMap<string, Initial>,
  reference: (name: string) => void,
): boolean {
  const ancestors: AST.SvelteNode[] = [];
  const scopes = new Map<AST.SvelteNode, Set<string>>();
  const unresolved = (name: string) =>
    RUNE_NAMES.has(name) &&
    !outer.has(name) &&
    !ancestors.some((ancestor) => declaredIn(ancestor, scopes).has(name));
  let functions = 0;
  let awaits = false;
  walk(root, {
    enter(node, parent) {
      if (isFunction(node)) functions++;
      else if (node.type === "AwaitExpression") awaits ||= functions === 0;
      let name: string | undefined;
      if (
        node.type === "Identifier" &&
        parent &&
        !parent.type.startsWith("TS") &&
        isReference(node, parent)
      ) {
        name = node.name;
      } else if (
        node.type === "TransitionDirective" ||
        node.type === "AnimateDirective" ||
        node.type === "UseDirective"
      ) {
        name = node.name.split(".")[0];
      } else if (node.type === "StyleDirective" && node.value === true) {
        name = node.name;
      }
      if (name !== undefined && unresolved(name)) reference(name);
      ancestors.push(node);
    },
    leave(node) {
      ancestors.pop();
      if (isFunction(node)) functions--;
    },
  });
  return awaits;
}

const NO_NAMES = new Set<string>();

/**
 * The names `node` declares for its descendants, if it's a function, a
 * catch clause, a snippet or an each block. A function's are its
 * parameters and every declaration in its body outside nested functions,
 * blocks included.
 */
function declaredIn(
  node: AST.SvelteNode,
  scopes: Map<AST.SvelteNode, Set<string>>,
): Set<string> {
  let names = scopes.get(node);
  if (names) return names;
  const patterns: Parameters<typeof extractIdentifiers>[0][] = [];
  if (isFunction(node)) {
    patterns.push(...node.params);
    if (node.type === "FunctionExpression" && node.id) patterns.push(node.id);
  } else if (node.type === "CatchClause" && node.param) {
    patterns.push(node.param);
  } else if (node.type === "SnippetBlock") {
    // undefined where TypeScript reads the signature as a type assertion
    patterns.push(...(node.parameters ?? []));
  } else if (node.type === "EachBlock" && node.context) {
    patterns.push(node.context);
  }
  if (patterns.length === 0 && !isFunction(node)) {
    scopes.set(node, NO_NAMES);
    return NO_NAMES;
  }
  names = new Set(
    patterns
      .flatMap((pattern) => extractIdentifiers(pattern))
      .map((id) => id.name),
  );
  if (isFunction(node)) {
    const { body } = node;
    walk(body, {
      enter(inner) {
        if (inner === body) return;
        if (inner.type === "VariableDeclaration") {
          for (const declarator of inner.declarations) {
            for (const id of extractIdentifiers(declarator.id))
              names?.add(id.name);
          }
        } else if (
          (inner.type === "FunctionDeclaration" ||
            inner.type === "ClassDeclaration") &&
          inner.id
        ) {
          names?.add(inner.id.name);
        }
        return isFunction(inner) ? SKIP : undefined;
      },
    });
  }
  scopes.set(node, names);
  return names;
}

type FunctionNode =
  | ArrowFunctionExpression
  | FunctionDeclaration
  | FunctionExpression;

function isFunction(node: AST.SvelteNode): node is FunctionNode {
  return (
    node.type === "ArrowFunctionExpression" ||
    node.type === "FunctionExpression" ||
    node.type === "FunctionDeclaration"
  );
}

/**
 * The names a script declares in its own scope, with what svelte keeps
 * as each one's initial value: a `var` outside the top level is hoisted
 * without one, and so is a name the instance script assigns in `$:`.
 */
function declare(
  program: Program,
  into: Map<string, Initial>,
  instance: boolean,
): void {
  const implicit: Identifier[] = [];
  walk(program, {
    enter(node, parent) {
      if (isFunction(node) && node.type !== "FunctionDeclaration") {
        return SKIP;
      }
      const topLevel =
        parent === program ||
        parent?.type === "ExportNamedDeclaration" ||
        parent?.type === "ExportDefaultDeclaration";
      if (node.type === "ImportDeclaration") {
        for (const specifier of node.specifiers) {
          into.set(specifier.local.name, node);
        }
        return SKIP;
      }
      if (
        node.type === "FunctionDeclaration" ||
        node.type === "ClassDeclaration"
      ) {
        if (topLevel && node.id) into.set(node.id.name, node);
        return SKIP;
      }
      if (node.type === "VariableDeclaration") {
        if (node.kind !== "var" && !topLevel) return SKIP;
        for (const declarator of node.declarations) {
          for (const id of extractIdentifiers(declarator.id)) {
            into.set(id.name, topLevel ? (declarator.init ?? null) : null);
          }
        }
        return SKIP;
      }
      if (
        instance &&
        parent === program &&
        node.type === "LabeledStatement" &&
        node.label.name === "$" &&
        node.body.type === "ExpressionStatement" &&
        node.body.expression.type === "AssignmentExpression"
      ) {
        for (const id of extractIdentifiers(node.body.expression.left)) {
          if (!id.name.startsWith("$")) implicit.push(id);
        }
      }
      return;
    },
  });
  for (const id of implicit) {
    if (!into.has(id.name)) into.set(id.name, null);
  }
}

/** The rune `initial` calls, as svelte's `get_rune` finds it: `null` if it isn't a call, or its callee names a declared binding. */
function runeOf(
  initial: Initial,
  declared: Map<string, Initial>,
): string | null {
  if (initial?.type !== "CallExpression") return null;
  let node: Expression | Super = initial.callee;
  let keypath = "";
  while (node.type === "MemberExpression") {
    if (node.computed || node.property.type !== "Identifier") return null;
    keypath = `.${node.property.name}${keypath}`;
    node = node.object;
  }
  if (node.type === "CallExpression" && node.callee.type === "Identifier") {
    keypath = `()${keypath}`;
    node = node.callee;
  }
  if (node.type !== "Identifier" || declared.has(node.name)) return null;
  keypath = node.name + keypath;
  return RUNES.has(keypath) ? keypath : null;
}
