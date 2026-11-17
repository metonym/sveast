// The warnings svelte gives for a component's `<script>` tags,
// `<svelte:options>` and what its parser saw, from svelte 5's
// phases/1-parse and phases/2-analyze/index.js. svelte gives each one
// outside its walk of the markup, so no `svelte-ignore` comment silences
// it. svelte is MIT licensed.
import { parseWarnings } from "./parse-warnings";
import type { AST } from "./types/svelte-ast";

interface Span {
  start: number;
  end: number;
}
type Warn = (node: Span, code: string, message: string) => void;

const link = (code: string) => `\nhttps://svelte.dev/e/${code}`;

// svelte's `ALLOWED_ATTRIBUTES` in read/script.js.
const SCRIPT_ATTRIBUTES = new Set(["context", "generics", "lang", "module"]);

export function componentWarnings(
  ast: AST.Root,
  runes: boolean,
  customElement: boolean,
  warn: Warn,
): void {
  const report = (node: Span, code: string, message: string) =>
    warn(node, code, message + link(code));

  for (const warning of parseWarnings(ast)) {
    if (warning.code === "element_implicitly_closed") {
      report(
        warning,
        warning.code,
        `This element is implicitly closed by the following \`${warning.by}\`, which can cause an unexpected DOM structure. Add an explicit \`${warning.closing}\` to avoid surprises.`,
      );
    } else {
      report(
        warning,
        warning.code,
        "`this` should be an `{expression}`. Using a string attribute value will cause an error in future versions of Svelte",
      );
    }
  }

  for (const script of [ast.module, ast.instance]) {
    if (!script) continue;
    for (const attribute of script.attributes) {
      if (!SCRIPT_ATTRIBUTES.has(attribute.name)) {
        report(
          attribute,
          "script_unknown_attribute",
          "Unrecognised attribute — should be one of `generics`, `lang` or `module`. If this exists for a preprocessor, ensure that the preprocessor removes it",
        );
      }
    }
  }

  if (runes && ast.module) {
    const context = ast.module.attributes.find(
      (attribute) => attribute.name === "context",
    );
    if (context) {
      report(
        context,
        "script_context_deprecated",
        '`context="module"` is deprecated, use the `module` attribute instead',
      );
    }
  }

  for (const attribute of ast.options?.attributes ?? []) {
    if (attribute.name === "accessors" && runes) {
      report(
        attribute,
        "options_deprecated_accessors",
        "The `accessors` option has been deprecated. It will have no effect in runes mode",
      );
    }
    if (attribute.name === "customElement" && !customElement) {
      report(
        attribute,
        "options_missing_custom_element",
        "The `customElement` option is used when generating a custom element. Did you forget the `customElement: true` compile option?",
      );
    }
    if (attribute.name === "immutable" && runes) {
      report(
        attribute,
        "options_deprecated_immutable",
        "The `immutable` option has been deprecated. It will have no effect in runes mode",
      );
    }
  }
}
