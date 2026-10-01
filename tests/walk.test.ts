import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type AST, parse, parseModule, visitorKeys, walk } from "sveast";
import { byCodeUnit, isRecord } from "../scripts/shared";
import { SNIPPETS } from "./ts-snippets";

const COMMENTS = new Set(["comments", "leadingComments", "trailingComments"]);
// Children that can come in either order in the source.
const UNORDERED = new Set([
  "Root", // walked in scope order: module, instance, fragment, css
  "TemplateLiteral", // quasis and expressions interleave
  "SvelteElement", // `this` can be any of the attributes
  "SvelteComponent",
]);

const CORPUS = join(import.meta.dir, "corpus");
const FILES = readdirSync(CORPUS, { recursive: true, encoding: "utf8" }).sort(
  byCodeUnit,
);

function corpusAsts(): AST.SvelteNode[] {
  const asts: AST.SvelteNode[] = [];
  for (const path of FILES) {
    const source = () => readFileSync(join(CORPUS, path), "utf8");
    try {
      if (path.endsWith(".svelte")) {
        asts.push(parse(source()));
      } else if (path.endsWith(".js") || path.endsWith(".ts")) {
        asts.push(parseModule(source(), { typescript: path.endsWith(".ts") }));
      }
    } catch {
      // files neither parser accepts have no AST to walk
    }
  }
  for (const snippet of Object.values(SNIPPETS)) {
    asts.push(parseModule(snippet, { typescript: true }));
  }
  return asts;
}

const ASTS = corpusAsts();

/** Where `root` holds a node that `walk` doesn't reach, as `Type.field`. Not its descendants, which it doesn't reach either. */
function unreached(root: AST.SvelteNode, reached: Set<object>): string[] {
  const found: string[] = [];
  const visit = (value: unknown, owner: string) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item, owner);
      return;
    }
    if (!isRecord(value)) return;
    const type = typeof value.type === "string" ? value.type : undefined;
    if (type && !reached.has(value)) {
      found.push(owner);
      return;
    }
    for (const key in value) {
      if (COMMENTS.has(key) || (type === "Root" && key === "options")) {
        continue;
      }
      visit(value[key], type ? `${type}.${key}` : `${owner}.${key}`);
    }
  };
  visit(root, "(root)");
  return found;
}

/** Where a node's position in the source is: its start, or a fragment's first node's. */
function position(node: AST.SvelteNode): number | undefined {
  if (node.type === "Fragment") return node.nodes[0]?.start;
  return "start" in node ? node.start : undefined;
}

// acorn shares one Identifier between both names of `{ a }` in an import or
// export, so walk visits it once under each.
const SHARED = new Set(["ImportSpecifier.local", "ExportSpecifier.exported"]);

test("walk reaches every node in the corpus once", () => {
  const found = new Set<string>();
  for (const ast of ASTS) {
    const reached = new Set<object>();
    walk(ast, {
      enter(node, parent, key) {
        const at = `${parent?.type}.${key}`;
        if (reached.has(node) && !SHARED.has(at)) {
          found.add(`${at}: visited twice`);
        }
        reached.add(node);
      },
    });
    for (const owner of unreached(ast, reached)) found.add(owner);
  }
  expect([...found].sort(byCodeUnit)).toEqual([]);
});

test("walk visits each node's children in source order", () => {
  const found = new Set<string>();
  for (const ast of ASTS) {
    const last = new Map<AST.SvelteNode, { at: number; key: string }>();
    walk(ast, {
      enter(node, parent, key) {
        if (!parent || !key || UNORDERED.has(parent.type)) return;
        const at = position(node);
        if (at === undefined) return;
        const previous = last.get(parent);
        if (previous && at < previous.at) {
          found.add(`${parent.type}.${key} before ${previous.key}`);
        }
        last.set(parent, { at, key });
      },
    });
  }
  expect([...found].sort(byCodeUnit)).toEqual([]);
});

test("parent, key and index locate the node", () => {
  const found = new Set<string>();
  const roots: unknown[] = [];
  for (const ast of ASTS) {
    walk(ast, {
      enter(node, parent, key, index) {
        if (parent === null || key === null) {
          roots.push([node, parent, key, index]);
          return;
        }
        const field: unknown = Reflect.get(parent, key);
        const held =
          index === null ? field : Array.isArray(field) && field[index];
        if (held !== node) found.add(`${parent.type}.${key}`);
      },
    });
  }
  expect([...found].sort(byCodeUnit)).toEqual([]);
  expect(roots).toEqual(ASTS.map((ast) => [ast, null, null, null]));
});

test("enter returning false skips the children, and leave still runs", () => {
  const ast = parse("<div><p>{a}</p></div><span></span>");
  const events: string[] = [];
  walk(ast.fragment, {
    enter(node) {
      events.push(`enter ${node.type}`);
      return !(node.type === "RegularElement" && node.name === "p");
    },
    leave(node) {
      events.push(`leave ${node.type}`);
    },
  });
  expect(events).toEqual([
    "enter Fragment",
    "enter RegularElement",
    "enter Fragment",
    "enter RegularElement",
    "leave RegularElement",
    "leave Fragment",
    "leave RegularElement",
    "enter RegularElement",
    "enter Fragment",
    "leave Fragment",
    "leave RegularElement",
    "leave Fragment",
  ]);
});

test("walk visits a component's sections in scope order", () => {
  const ast = parse(
    "<style>p{}</style><p>{a}</p><script>let a;</script><script module>export const b = 1;</script>",
  );
  const sections: string[] = [];
  walk(ast, {
    enter(node, parent, key) {
      if (parent?.type === "Root" && key) sections.push(`${key} ${node.type}`);
    },
  });
  expect(sections).toEqual([
    "module Script",
    "instance Script",
    "fragment Fragment",
    "css StyleSheet",
  ]);
});

test("walk throws on a node type it doesn't know", () => {
  const node: AST.SvelteNode = JSON.parse('{"type":"Unknown"}');
  expect(() => walk(node, {})).toThrow("unknown node type: Unknown");
});

test("visitorKeys lists the fields that hold children", () => {
  expect(visitorKeys.IfBlock).toEqual(["test", "consequent", "alternate"]);
  expect(visitorKeys.Text).toEqual([]);
});
