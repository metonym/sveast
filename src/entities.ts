import { htmlEntityNames } from "./entity-names";
import type { EntitySupport } from "./options";
import { entitySupport } from "./support";

/**
 * HTML's named character references, such as `&nbsp;` and `&copy;`, for
 * `createParser` from `sveast/core`, so `Text.data` and attribute values
 * decode them as svelte does.
 */
export const entities: EntitySupport =
  /* @__PURE__ */ entitySupport(htmlEntityNames);
