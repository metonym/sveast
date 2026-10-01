import type { TypeScriptSupport } from "./options";
import { typeScriptSupport } from "./support";
import { TypeScriptParser } from "./typescript-parser";

/**
 * TypeScript support for `createParser` from `sveast/core`, so it parses
 * `<script lang="ts">` and `parseModule(source, { typescript: true })`.
 */
export const typescript: TypeScriptSupport =
  /* @__PURE__ */ typeScriptSupport(TypeScriptParser);
