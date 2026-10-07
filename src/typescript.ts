import type { TypeScriptSupport } from "./options";
import { typeScriptSupport } from "./support";
import { TypeScriptParser } from "./typescript-parser";

/**
 * TypeScript support for `createParser` from `sveast/core` and
 * `createModuleParser` from `sveast/module`, so they parse
 * `<script lang="ts">` and `typescript: true`.
 */
export const typescript: TypeScriptSupport =
  /* @__PURE__ */ typeScriptSupport(TypeScriptParser);
