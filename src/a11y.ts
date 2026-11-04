// A port of svelte's a11y checks (src/compiler/phases/2-analyze/visitors/
// shared/a11y/index.js), which svelte runs on every element as it
// analyzes a component, with its `svelte-ignore` handling from
// phases/2-analyze/index.js and utils/extract_svelte_ignore.js. The tables
// in `a11y-data.ts` and the messages in `a11y-messages.ts` are generated
// from svelte's sources. svelte is MIT licensed.
import {
  a11yDistractingElements,
  a11yImplicitSemantics,
  a11yInteractiveHandlers,
  a11yLabelable,
  a11yNestedImplicitSemantics,
  a11yNonInteractiveElementToInteractiveRoleExceptions,
  a11yRecommendedInteractiveHandlers,
  a11yRequiredAttributes,
  a11yRequiredContent,
  abstractRoles as abstractRolesData,
  addressTypeTokens as addressTypeTokensData,
  ariaAttributes as ariaAttributesData,
  ariaProperties as ariaPropertiesData,
  ariaRoles as ariaRolesData,
  autofillContactFieldNameTokens as autofillContactFieldNameTokensData,
  autofillFieldNameTokens as autofillFieldNameTokensData,
  comboboxIfList as comboboxIfListData,
  contactTypeTokens as contactTypeTokensData,
  ElementInteractivity,
  inputTypeToImplicitRole as inputTypeToImplicitRoleData,
  interactiveElementAxObjectSchemas as interactiveElementAxObjectSchemasData,
  interactiveElementRoleSchemas as interactiveElementRoleSchemasData,
  interactiveRoles as interactiveRolesData,
  invisibleElements as invisibleElementsData,
  menuitemTypeToImplicitRole as menuitemTypeToImplicitRoleData,
  nonInteractiveElementAxObjectSchemas as nonInteractiveElementAxObjectSchemasData,
  nonInteractiveElementRoleSchemas as nonInteractiveElementRoleSchemasData,
  nonInteractiveRoles as nonInteractiveRolesData,
  presentationRoles as presentationRolesData,
  roleProps as rolePropsData,
  semanticRoleElements as semanticRoleElementsData,
} from "./a11y-data";
import { fuzzymatch } from "./a11y-fuzzymatch";
import {
  a11y_accesskey,
  a11y_aria_activedescendant_has_tabindex,
  a11y_aria_attributes,
  a11y_autocomplete_valid,
  a11y_autofocus,
  a11y_click_events_have_key_events,
  a11y_consider_explicit_label,
  a11y_distracting_elements,
  a11y_figcaption_index,
  a11y_figcaption_parent,
  a11y_hidden,
  a11y_img_redundant_alt,
  a11y_incorrect_aria_attribute_type,
  a11y_incorrect_aria_attribute_type_boolean,
  a11y_incorrect_aria_attribute_type_idlist,
  a11y_incorrect_aria_attribute_type_integer,
  a11y_incorrect_aria_attribute_type_token,
  a11y_incorrect_aria_attribute_type_tokenlist,
  a11y_incorrect_aria_attribute_type_tristate,
  a11y_interactive_supports_focus,
  a11y_invalid_attribute,
  a11y_label_has_associated_control,
  a11y_media_has_caption,
  a11y_misplaced_role,
  a11y_misplaced_scope,
  a11y_missing_attribute,
  a11y_missing_content,
  a11y_mouse_events_have_key_events,
  a11y_no_abstract_role,
  a11y_no_interactive_element_to_noninteractive_role,
  a11y_no_noninteractive_element_interactions,
  a11y_no_noninteractive_element_to_interactive_role,
  a11y_no_noninteractive_tabindex,
  a11y_no_redundant_roles,
  a11y_no_static_element_interactions,
  a11y_positive_tabindex,
  a11y_role_has_required_aria_props,
  a11y_role_supports_aria_props,
  a11y_role_supports_aria_props_implicit,
  a11y_unknown_aria_attribute,
  a11y_unknown_role,
} from "./a11y-messages";
import type { AST } from "./types/svelte-ast";
import { forEachChild, markupVisitorKeys } from "./walk";

/** A warning svelte's compiler would give for the component's accessibility. */
export interface A11yWarning {
  /** svelte's code, such as `"a11y_missing_attribute"`. */
  code: string;
  /** svelte's message: the reason, a line break, and the link to the warning's docs. */
  message: string;
  start: number;
  end: number;
}

export interface A11yOptions {
  /**
   * Whether the component compiles in runes mode, as {@link isRunesMode}
   * says. It decides how `<!-- svelte-ignore -->` reads its codes: in
   * runes mode only svelte 5's codes, separated by commas, count; in
   * legacy mode svelte 4's `a11y-…` codes do too. Default `false`.
   */
  runes?: boolean;
}

type Element = AST.RegularElement | AST.SvelteElement;
interface Node {
  type: string;
  start: number;
  end: number;
  name?: string;
}
type Interactivity =
  (typeof ElementInteractivity)[keyof typeof ElementInteractivity];
interface Schema {
  readonly name: string;
  readonly attributes?: readonly {
    readonly name: string;
    readonly value?: string;
  }[];
}

const distractingElements: readonly string[] = a11yDistractingElements;
const implicitSemantics: Readonly<Record<string, string>> =
  a11yImplicitSemantics;
const interactiveHandlers: readonly string[] = a11yInteractiveHandlers;
const labelable: readonly string[] = a11yLabelable;
const nestedImplicitSemantics: Readonly<Record<string, string>> =
  a11yNestedImplicitSemantics;
const toInteractiveRoleExceptions: Readonly<Record<string, readonly string[]>> =
  a11yNonInteractiveElementToInteractiveRoleExceptions;
const recommendedInteractiveHandlers: readonly string[] =
  a11yRecommendedInteractiveHandlers;
const requiredAttributes: Readonly<Record<string, readonly string[]>> =
  a11yRequiredAttributes;
const requiredContent: readonly string[] = a11yRequiredContent;
const abstractRoles: readonly string[] = abstractRolesData;
const addressTypeTokens: readonly string[] = addressTypeTokensData;
const ariaAttributes: readonly string[] = ariaAttributesData;
const ariaProperties: Readonly<
  Record<string, { readonly type: string; readonly values?: readonly string[] }>
> = ariaPropertiesData;
const ariaPropertyNames = Object.keys(ariaProperties);
const ariaRoles: readonly string[] = ariaRolesData;
const autofillContactFieldNameTokens: readonly string[] =
  autofillContactFieldNameTokensData;
const autofillFieldNameTokens: readonly string[] = autofillFieldNameTokensData;
const comboboxIfList: readonly string[] = comboboxIfListData;
const contactTypeTokens: readonly string[] = contactTypeTokensData;
const inputTypeToImplicitRole: Readonly<Record<string, string>> =
  inputTypeToImplicitRoleData;
const interactiveElementAxObjectSchemas: readonly Schema[] =
  interactiveElementAxObjectSchemasData;
const interactiveElementRoleSchemas: readonly Schema[] =
  interactiveElementRoleSchemasData;
const interactiveRoles: readonly string[] = interactiveRolesData;
const invisibleElements: readonly string[] = invisibleElementsData;
const menuitemTypeToImplicitRole: Readonly<Record<string, string>> =
  menuitemTypeToImplicitRoleData;
const nonInteractiveElementAxObjectSchemas: readonly Schema[] =
  nonInteractiveElementAxObjectSchemasData;
const nonInteractiveElementRoleSchemas: readonly Schema[] =
  nonInteractiveElementRoleSchemasData;
const nonInteractiveRoles: readonly string[] = nonInteractiveRolesData;
const presentationRoles: readonly string[] = presentationRolesData;
const roleProps: Readonly<
  Record<
    string,
    { readonly props: readonly string[]; readonly required: readonly string[] }
  >
> = rolePropsData;
const semanticRoleElements: readonly (Schema & {
  readonly roles: readonly string[];
})[] = semanticRoleElementsData;
const { Interactive, NonInteractive, Static } = ElementInteractivity;

const HEADING_TAGS = /^h[1-6]$/;
const JS_PREFIX = /^\W*javascript:/i;
const NOT_WHITESPACE = /[^ \t\r\n]/;
const REDUNDANT_IMG_ALT = /\b(image|picture|photo)\b/i;
const STARTS_WITH_VOWEL = /^[aeiou]/;
const WHITESPACES = /\s+/;
const WHITESPACES_STRICT = /[ \t\n\r\f]+/g;
const UPPERCASE = /[A-Z]/g;
const SVELTE_IGNORE = /^\s*svelte-ignore\s/;
const IGNORE_CODE = /[\w$-]+/gm;
const IGNORE_CODE_COMMA = /([\w$-]+)(,)?/gm;
const HYPHEN = /-/g;
const CONTENT_EDITABLE_BINDINGS = ["textContent", "innerHTML", "innerText"];

// svelte 4's codes that svelte 5 renamed, besides `-` to `_`.
const REPLACEMENTS: Readonly<Record<string, string>> = {
  "a11y-structure": "a11y_figcaption_parent",
};

/**
 * The warnings svelte's compiler gives for a component's accessibility,
 * the `a11y_…` ones, with the same codes, messages and positions, and
 * none that a `<!-- svelte-ignore -->` comment silences.
 *
 * ```ts
 * import { isRunesMode, parse } from "sveast";
 * import { a11yWarnings } from "sveast/a11y";
 *
 * const warnings = a11yWarnings(parse(source), { runes: isRunesMode(source) });
 * ```
 */
export function a11yWarnings(
  ast: AST.Root,
  options: A11yOptions = {},
): A11yWarning[] {
  const warnings: A11yWarning[] = [];
  const runes = options.runes ?? false;
  const path: Node[] = [];
  const visit = (
    node: Node,
    parent: Node | undefined,
    ignored: ReadonlySet<string>,
  ): void => {
    let ignores = ignored;
    if (
      parent?.type === "Fragment" &&
      node.type !== "Comment" &&
      node.type !== "Text"
    ) {
      const codes = ignoredBefore(
        parent as unknown as AST.Fragment,
        node,
        runes,
      );
      if (codes.length > 0) ignores = new Set([...ignored, ...codes]);
    }
    if (node.type === "RegularElement" || node.type === "SvelteElement") {
      checkElement(node as Element, path, (at, code, message) => {
        if (!ignores.has(code))
          warnings.push({ code, message, start: at.start, end: at.end });
      });
    }
    path.push(node);
    forEachChild(
      node as never,
      (child) => visit(child as Node, node, ignores),
      markupVisitorKeys,
    );
    path.pop();
  };
  visit(ast.fragment as unknown as Node, ast as unknown as Node, new Set());
  return warnings;
}

/** The codes the comments right before `node` in its fragment ignore. */
function ignoredBefore(
  fragment: AST.Fragment,
  node: Node,
  runes: boolean,
): string[] {
  const codes: string[] = [];
  const index = fragment.nodes.indexOf(node as never);
  for (let i = index - 1; i >= 0; i--) {
    const previous = fragment.nodes[i];
    if (previous.type === "Comment")
      codes.push(...ignoreCodes(previous.data, runes));
    else if (previous.type !== "Text") break;
  }
  return codes;
}

function ignoreCodes(text: string, runes: boolean): string[] {
  const match = SVELTE_IGNORE.exec(text);
  if (!match) return [];
  const rest = text.slice(match[0].length);
  const codes: string[] = [];
  if (runes) {
    // Codes are separated by commas; anything after the last one is prose.
    // svelte 4's codes, with hyphens, don't count.
    for (const [, code, comma] of rest.matchAll(IGNORE_CODE_COMMA)) {
      if (!code.includes("-")) codes.push(code);
      if (!comma) break;
    }
  } else {
    for (const [code] of rest.matchAll(IGNORE_CODE)) {
      codes.push(code, REPLACEMENTS[code] ?? code.replace(HYPHEN, "_"));
    }
  }
  return codes;
}

type Warn = (node: Node, code: string, message: string) => void;

function checkElement(node: Element, path: readonly Node[], warn: Warn): void {
  const attributeMap = new Map<string, AST.Attribute>();
  const handlers = new Set<string>();
  const attributes: AST.Attribute[] = [];
  const isDynamicElement = node.type === "SvelteElement";
  let hasSpread = false;
  let hasContenteditableAttr = false;
  let hasContenteditableBinding = false;

  for (const attribute of node.attributes) {
    switch (attribute.type) {
      case "Attribute":
        if (isEventAttribute(attribute)) {
          handlers.add(attribute.name.slice(2));
        } else {
          attributes.push(attribute);
          attributeMap.set(attribute.name, attribute);
          if (attribute.name === "contenteditable")
            hasContenteditableAttr = true;
        }
        break;
      case "SpreadAttribute":
        hasSpread = true;
        break;
      case "BindDirective":
        if (CONTENT_EDITABLE_BINDINGS.includes(attribute.name))
          hasContenteditableBinding = true;
        break;
      case "OnDirective":
        handlers.add(attribute.name);
        break;
    }
  }

  const interactivity = elementInteractivity(node.name, attributeMap);
  const isInteractive = interactivity === Interactive;
  const isNonInteractive = interactivity === NonInteractive;
  const isStatic = interactivity === Static;

  for (const attribute of node.attributes) {
    if (attribute.type !== "Attribute") continue;
    const name = attribute.name.toLowerCase();
    if (name.startsWith("aria-")) {
      if (invisibleElements.includes(node.name)) {
        warn(
          attribute,
          "a11y_aria_attributes",
          a11y_aria_attributes(node.name),
        );
      }
      const type = name.slice(5);
      if (!ariaAttributes.includes(type)) {
        const match = fuzzymatch(type, ariaAttributes);
        warn(
          attribute,
          "a11y_unknown_aria_attribute",
          a11y_unknown_aria_attribute(type, match as string),
        );
      }
      if (name === "aria-hidden" && HEADING_TAGS.test(node.name)) {
        warn(attribute, "a11y_hidden", a11y_hidden(node.name));
      }
      const value = staticValue(attribute);
      const schema = ariaProperties[name];
      if (schema !== undefined)
        validateAriaAttributeValue(attribute, name, schema, value, warn);
      if (
        name === "aria-activedescendant" &&
        !isDynamicElement &&
        !isInteractive &&
        !attributeMap.has("tabindex") &&
        !hasSpread
      ) {
        warn(
          attribute,
          "a11y_aria_activedescendant_has_tabindex",
          a11y_aria_activedescendant_has_tabindex(),
        );
      }
    }

    switch (name) {
      case "role": {
        if (invisibleElements.includes(node.name)) {
          warn(
            attribute,
            "a11y_misplaced_role",
            a11y_misplaced_role(node.name),
          );
        }
        const value = staticValue(attribute);
        if (typeof value !== "string") break;
        for (const currentRole of roleTokens(value)) {
          if (currentRole && isAbstractRole(currentRole)) {
            warn(
              attribute,
              "a11y_no_abstract_role",
              a11y_no_abstract_role(currentRole),
            );
          } else if (currentRole && !ariaRoles.includes(currentRole)) {
            const match = fuzzymatch(currentRole, ariaRoles);
            warn(
              attribute,
              "a11y_unknown_role",
              a11y_unknown_role(currentRole, match as string),
            );
          }
          if (
            currentRole === implicitRole(node.name, attributeMap) &&
            // `<ul role="list">` brings back the semantics `list-style: none` removes.
            !["ul", "ol", "li", "menu"].includes(node.name) &&
            // `<a>` and `<area>` without `href` have no role of link.
            !(
              (node.name === "a" || node.name === "area") &&
              !attributeMap.has("href")
            )
          ) {
            warn(
              attribute,
              "a11y_no_redundant_roles",
              a11y_no_redundant_roles(currentRole),
            );
          }
          // A footer's or header's role is redundant unless it's in a section or an article.
          if (
            !isParent(path, ["section", "article"]) &&
            currentRole === nestedImplicitSemantics[node.name]
          ) {
            warn(
              attribute,
              "a11y_no_redundant_roles",
              a11y_no_redundant_roles(currentRole),
            );
          }
          if (
            !isDynamicElement &&
            !isSemanticRoleElement(currentRole, node.name, attributeMap)
          ) {
            const role = roleProps[currentRole];
            if (role) {
              const missing =
                !hasSpread &&
                role.required.some(
                  (prop) => !attributes.find((a) => a.name === prop),
                );
              if (missing) {
                warn(
                  attribute,
                  "a11y_role_has_required_aria_props",
                  a11y_role_has_required_aria_props(
                    currentRole,
                    list(
                      role.required.map((v) => `"${v}"`),
                      "and",
                    ),
                  ),
                );
              }
            }
          }
          if (
            !hasSpread &&
            !hasDisabledAttribute(attributeMap) &&
            !isHiddenFromScreenReader(node.name, attributeMap) &&
            !isPresentationRole(currentRole) &&
            isInteractiveRole(currentRole) &&
            isStatic &&
            !attributeMap.get("tabindex") &&
            [...handlers].some((handler) =>
              interactiveHandlers.includes(handler),
            )
          ) {
            warn(
              node,
              "a11y_interactive_supports_focus",
              a11y_interactive_supports_focus(currentRole),
            );
          }
          if (
            !hasSpread &&
            isInteractive &&
            (isNonInteractiveRole(currentRole) ||
              isPresentationRole(currentRole))
          ) {
            warn(
              node,
              "a11y_no_interactive_element_to_noninteractive_role",
              a11y_no_interactive_element_to_noninteractive_role(
                node.name,
                currentRole,
              ),
            );
          }
          if (
            !hasSpread &&
            isNonInteractive &&
            isInteractiveRole(currentRole) &&
            !toInteractiveRoleExceptions[node.name]?.includes(currentRole)
          ) {
            warn(
              node,
              "a11y_no_noninteractive_element_to_interactive_role",
              a11y_no_noninteractive_element_to_interactive_role(
                node.name,
                currentRole,
              ),
            );
          }
        }
        break;
      }
      case "accesskey":
        warn(attribute, "a11y_accesskey", a11y_accesskey());
        break;
      case "autofocus":
        if (node.name !== "dialog" && !isParent(path, ["dialog"])) {
          warn(attribute, "a11y_autofocus", a11y_autofocus());
        }
        break;
      case "scope":
        if (!isDynamicElement && node.name !== "th") {
          warn(attribute, "a11y_misplaced_scope", a11y_misplaced_scope());
        }
        break;
      case "tabindex": {
        const value = staticValue(attribute);
        if (!Number.isNaN(Number(value)) && Number(value) > 0) {
          warn(attribute, "a11y_positive_tabindex", a11y_positive_tabindex());
        }
        break;
      }
    }
  }

  const role = attributeMap.get("role");
  const roleStaticValue = effectiveRole(staticTextValue(role));

  if (handlers.has("click")) {
    const isNonPresentationRole =
      roleStaticValue !== null && !isPresentationRole(roleStaticValue);
    if (
      !isDynamicElement &&
      !isHiddenFromScreenReader(node.name, attributeMap) &&
      (!role || isNonPresentationRole) &&
      !isInteractive &&
      !hasSpread &&
      !(
        handlers.has("keydown") ||
        handlers.has("keyup") ||
        handlers.has("keypress")
      )
    ) {
      warn(
        node,
        "a11y_click_events_have_key_events",
        a11y_click_events_have_key_events(node.name),
      );
    }
  }

  const roleValue = role
    ? roleStaticValue
    : implicitRole(node.name, attributeMap);

  if (
    !isDynamicElement &&
    !isInteractive &&
    !isInteractiveRole(roleStaticValue)
  ) {
    const tabIndex = attributeMap.get("tabindex");
    const tabIndexValue = staticTextValue(tabIndex);
    if (tabIndex && (tabIndexValue === null || Number(tabIndexValue) >= 0)) {
      warn(
        node,
        "a11y_no_noninteractive_tabindex",
        a11y_no_noninteractive_tabindex(),
      );
    }
  }

  if (typeof roleValue === "string" && roleProps[roleValue]) {
    const { props } = roleProps[roleValue];
    const invalid = ariaPropertyNames.filter(
      (attribute) => !props.includes(attribute),
    );
    const isImplicit = role === undefined;
    for (const attr of attributes) {
      if (!invalid.includes(attr.name)) continue;
      if (isImplicit) {
        warn(
          attr,
          "a11y_role_supports_aria_props_implicit",
          a11y_role_supports_aria_props_implicit(
            attr.name,
            roleValue,
            node.name,
          ),
        );
      } else {
        warn(
          attr,
          "a11y_role_supports_aria_props",
          a11y_role_supports_aria_props(attr.name, roleValue),
        );
      }
    }
  }

  if (
    !hasSpread &&
    !hasContenteditableAttr &&
    !isHiddenFromScreenReader(node.name, attributeMap) &&
    !isPresentationRole(roleStaticValue) &&
    ((!isInteractive && isNonInteractiveRole(roleStaticValue)) ||
      (isNonInteractive && !role)) &&
    [...handlers].some((handler) =>
      recommendedInteractiveHandlers.includes(handler),
    )
  ) {
    warn(
      node,
      "a11y_no_noninteractive_element_interactions",
      a11y_no_noninteractive_element_interactions(node.name),
    );
  }

  if (
    !hasSpread &&
    (!role || roleStaticValue !== null) &&
    !isHiddenFromScreenReader(node.name, attributeMap) &&
    !isPresentationRole(roleStaticValue) &&
    !isInteractive &&
    !isInteractiveRole(roleStaticValue) &&
    !isNonInteractive &&
    !isNonInteractiveRole(roleStaticValue) &&
    !isAbstractRole(roleStaticValue)
  ) {
    const interactive = [...handlers].filter((handler) =>
      interactiveHandlers.includes(handler),
    );
    if (interactive.length > 0) {
      warn(
        node,
        "a11y_no_static_element_interactions",
        a11y_no_static_element_interactions(node.name, list(interactive)),
      );
    }
  }

  // `focus` and `blur` don't bubble, so `focusin` and `focusout` count too.
  if (
    !hasSpread &&
    handlers.has("mouseover") &&
    !handlers.has("focus") &&
    !handlers.has("focusin")
  ) {
    warn(
      node,
      "a11y_mouse_events_have_key_events",
      a11y_mouse_events_have_key_events("mouseover", "focus"),
    );
  }
  if (
    !hasSpread &&
    handlers.has("mouseout") &&
    !handlers.has("blur") &&
    !handlers.has("focusout")
  ) {
    warn(
      node,
      "a11y_mouse_events_have_key_events",
      a11y_mouse_events_have_key_events("mouseout", "blur"),
    );
  }

  const isLabelled =
    attributeMap.has("aria-label") ||
    attributeMap.has("aria-labelledby") ||
    attributeMap.has("title");

  switch (node.name) {
    case "a":
    case "button": {
      const isHidden =
        staticValue(attributeMap.get("aria-hidden")) === "true" ||
        staticValue(attributeMap.get("inert")) !== null;
      if (!hasSpread && !isHidden && !isLabelled && !hasContent(node)) {
        warn(
          node,
          "a11y_consider_explicit_label",
          a11y_consider_explicit_label(),
        );
      }
      if (node.name === "button") break;
      const href = attributeMap.get("href") || attributeMap.get("xlink:href");
      if (href) {
        const hrefValue = staticTextValue(href);
        if (
          hrefValue !== null &&
          (hrefValue === "" || hrefValue === "#" || JS_PREFIX.test(hrefValue))
        ) {
          warn(
            href,
            "a11y_invalid_attribute",
            a11y_invalid_attribute(hrefValue, href.name),
          );
        }
      } else if (!hasSpread) {
        const id = staticValue(attributeMap.get("id"));
        const name = staticValue(attributeMap.get("name"));
        const ariaDisabled = staticValue(attributeMap.get("aria-disabled"));
        if (!id && !name && ariaDisabled !== "true")
          warnMissingAttribute(node, ["href"], warn);
      }
      break;
    }
    case "input": {
      const type = attributeMap.get("type");
      const typeValue = staticTextValue(type);
      if (typeValue === "image" && !hasSpread) {
        const required = ["alt", "aria-label", "aria-labelledby"];
        if (!required.some((name) => attributeMap.has(name))) {
          warnMissingAttribute(node, required, warn, 'input type="image"');
        }
      }
      const autocomplete = attributeMap.get("autocomplete");
      if (type && autocomplete) {
        const value = staticValue(autocomplete);
        if (!isValidAutocomplete(value)) {
          warn(
            autocomplete,
            "a11y_autocomplete_valid",
            a11y_autocomplete_valid(value as string, typeValue ?? "..."),
          );
        }
      }
      break;
    }
    case "img": {
      const alt = staticTextValue(attributeMap.get("alt"));
      const ariaHidden = staticValue(attributeMap.get("aria-hidden"));
      if (alt && !ariaHidden && !hasSpread && REDUNDANT_IMG_ALT.test(alt)) {
        warn(node, "a11y_img_redundant_alt", a11y_img_redundant_alt());
      }
      break;
    }
    case "label":
      if (!hasSpread && !attributeMap.has("for") && !hasInputChild(node)) {
        warn(
          node,
          "a11y_label_has_associated_control",
          a11y_label_has_associated_control(),
        );
      }
      break;
    case "video": {
      const ariaHidden = attributeMap.get("aria-hidden");
      const hidden = ariaHidden && staticValue(ariaHidden);
      if (attributeMap.has("muted") || hidden === "true" || hasSpread) return;
      // A `<video>` without `src` could play a MediaStream.
      if (!attributeMap.has("src")) return;
      const track = node.fragment.nodes.find(
        (child): child is AST.RegularElement =>
          child.type === "RegularElement" && child.name === "track",
      );
      const hasCaption = track?.attributes.some(
        (a) =>
          a.type === "SpreadAttribute" ||
          (a.type === "Attribute" &&
            a.name === "kind" &&
            staticValue(a) === "captions"),
      );
      if (!hasCaption)
        warn(node, "a11y_media_has_caption", a11y_media_has_caption());
      break;
    }
    case "figcaption":
      if (!isParent(path, ["figure"]))
        warn(node, "a11y_figcaption_parent", a11y_figcaption_parent());
      break;
    case "figure": {
      const children = node.fragment.nodes.filter((child) => {
        if (child.type === "Comment") return false;
        if (child.type === "Text") return NOT_WHITESPACE.test(child.data);
        return true;
      });
      const index = children.findIndex(
        (child) =>
          child.type === "RegularElement" && child.name === "figcaption",
      );
      if (index !== -1 && index !== 0 && index !== children.length - 1) {
        warn(children[index], "a11y_figcaption_index", a11y_figcaption_index());
      }
      break;
    }
  }

  if (!hasSpread && node.name !== "a") {
    const required = requiredAttributes[node.name];
    if (required && !required.some((name) => attributeMap.has(name))) {
      warnMissingAttribute(node, [...required], warn);
    }
  }

  if (distractingElements.includes(node.name)) {
    warn(
      node,
      "a11y_distracting_elements",
      a11y_distracting_elements(node.name),
    );
  }

  if (
    !hasSpread &&
    !isLabelled &&
    !hasContenteditableBinding &&
    requiredContent.includes(node.name) &&
    !hasContent(node)
  ) {
    warn(node, "a11y_missing_content", a11y_missing_content(node.name));
  }
}

function isEventAttribute(attribute: AST.Attribute): boolean {
  const { value } = attribute;
  const expression =
    (value !== true && !Array.isArray(value)) ||
    (Array.isArray(value) &&
      value.length === 1 &&
      value[0].type === "ExpressionTag");
  return expression && attribute.name.startsWith("on");
}

function list(strings: readonly string[], conjunction = "or"): string {
  if (strings.length === 1) return strings[0];
  if (strings.length === 2) return `${strings[0]} ${conjunction} ${strings[1]}`;
  return `${strings.slice(0, -1).join(", ")} ${conjunction} ${strings[strings.length - 1]}`;
}

const isPresentationRole = (role: string | null | undefined) =>
  presentationRoles.includes(role as string);
const isNonInteractiveRole = (role: string | null | undefined) =>
  nonInteractiveRoles.includes(role as string);
const isInteractiveRole = (role: string | null | undefined) =>
  interactiveRoles.includes(role as string);
const isAbstractRole = (role: string | null | undefined) =>
  abstractRoles.includes(role as string);

function isHiddenFromScreenReader(
  tagName: string,
  attributeMap: Map<string, AST.Attribute>,
): boolean {
  if (tagName === "input" && staticValue(attributeMap.get("type")) === "hidden")
    return true;
  const ariaHidden = attributeMap.get("aria-hidden");
  if (!ariaHidden) return false;
  const value = staticValue(ariaHidden);
  if (value === null) return true;
  return value === true || value === "true";
}

function hasDisabledAttribute(
  attributeMap: Map<string, AST.Attribute>,
): boolean {
  if (staticValue(attributeMap.get("disabled"))) return true;
  const ariaDisabled = attributeMap.get("aria-disabled");
  return ariaDisabled != null && staticValue(ariaDisabled) === "true";
}

function elementInteractivity(
  tagName: string,
  attributeMap: Map<string, AST.Attribute>,
): Interactivity {
  if (
    interactiveElementRoleSchemas.some((schema) =>
      matchSchema(schema, tagName, attributeMap),
    )
  )
    return Interactive;
  if (
    tagName !== "header" &&
    nonInteractiveElementRoleSchemas.some((schema) =>
      matchSchema(schema, tagName, attributeMap),
    )
  ) {
    return NonInteractive;
  }
  if (
    interactiveElementAxObjectSchemas.some((schema) =>
      matchSchema(schema, tagName, attributeMap),
    )
  ) {
    return Interactive;
  }
  if (
    nonInteractiveElementAxObjectSchemas.some((schema) =>
      matchSchema(schema, tagName, attributeMap),
    )
  ) {
    return NonInteractive;
  }
  return Static;
}

function isSemanticRoleElement(
  role: string,
  tagName: string,
  attributeMap: Map<string, AST.Attribute>,
): boolean {
  return semanticRoleElements.some(
    (schema) =>
      schema.name === tagName &&
      (!schema.attributes ||
        schema.attributes.every(
          (attr) =>
            attributeMap.has(attr.name) &&
            staticValue(attributeMap.get(attr.name)) === attr.value,
        )) &&
      schema.roles.includes(role),
  );
}

function isValidAutocomplete(autocomplete: string | true | null): boolean {
  if (autocomplete === true) return false;
  // A dynamic value.
  if (!autocomplete) return true;
  const tokens = autocomplete.trim().toLowerCase().split(WHITESPACES);
  if (typeof tokens[0] === "string" && tokens[0].startsWith("section-"))
    tokens.shift();
  if (addressTypeTokens.includes(tokens[0])) tokens.shift();
  if (autofillFieldNameTokens.includes(tokens[0])) {
    tokens.shift();
  } else {
    if (contactTypeTokens.includes(tokens[0])) tokens.shift();
    if (autofillContactFieldNameTokens.includes(tokens[0])) tokens.shift();
    else return false;
  }
  if (tokens[0] === "webauthn") tokens.shift();
  return tokens.length === 0;
}

function implicitRole(
  name: string,
  attributeMap: Map<string, AST.Attribute>,
): string | undefined {
  if (name === "menuitem") {
    const type = staticTextValue(attributeMap.get("type"));
    return type ? menuitemTypeToImplicitRole[type] : undefined;
  }
  if (name === "input") {
    const type = staticTextValue(attributeMap.get("type"));
    if (!type) return undefined;
    if (attributeMap.has("list") && comboboxIfList.includes(type))
      return "combobox";
    return inputTypeToImplicitRole[type];
  }
  return implicitSemantics[name];
}

/** Role tokens are split on ASCII whitespace and compared ASCII case-insensitively. */
function roleTokens(value: string): string[] {
  return value
    .replace(UPPERCASE, (char) => char.toLowerCase())
    .split(WHITESPACES_STRICT);
}

/**
 * The first known, non-abstract role of a `role` that lists fallbacks, or
 * the whole value if none is, so an unknown role keeps its warnings.
 */
function effectiveRole(value: string | null): string | null {
  if (value === null) return null;
  return (
    roleTokens(value).find(
      (role) => ariaRoles.includes(role) && !isAbstractRole(role),
    ) ?? value
  );
}

function staticTextValue(attribute: AST.Attribute | undefined): string | null {
  const value = staticValue(attribute);
  return value === true ? null : value;
}

function staticValue(
  attribute: AST.Attribute | undefined,
): string | true | null {
  if (!attribute) return null;
  if (attribute.value === true) return true;
  const { value } = attribute;
  if (Array.isArray(value) && value.length === 1 && value[0].type === "Text")
    return value[0].data;
  return null;
}

function hasContent(element: Element): boolean {
  for (const node of element.fragment.nodes) {
    if (node.type === "Text" && node.data.trim() === "") continue;
    if (node.type === "RegularElement" || node.type === "SvelteElement") {
      if (
        node.attributes.some(
          (a) => a.type === "Attribute" && a.name === "popover",
        )
      )
        continue;
      if (
        node.name === "img" &&
        node.attributes.some((a) => a.type === "Attribute" && a.name === "alt")
      )
        return true;
      if (node.name === "selectedcontent") return true;
      if (!hasContent(node)) continue;
    }
    // Anything else counts as content, so an empty `{#if}` does too.
    return true;
  }
  return false;
}

function hasInputChild(label: Element): boolean {
  let found = false;
  const visit = (node: Node): void => {
    if (found) return;
    if (
      node.type === "SvelteElement" ||
      node.type === "SlotElement" ||
      node.type === "Component" ||
      node.type === "RenderTag" ||
      (node.type === "RegularElement" &&
        (labelable.includes(node.name as string) || node.name === "slot"))
    ) {
      found = true;
      return;
    }
    forEachChild(node as never, (child) => visit(child as Node));
  };
  forEachChild(label as never, (child) => visit(child as Node));
  return found;
}

function matchSchema(
  schema: Schema,
  tagName: string,
  attributeMap: Map<string, AST.Attribute>,
): boolean {
  if (schema.name !== tagName) return false;
  if (!schema.attributes) return true;
  return schema.attributes.every((schemaAttribute) => {
    const attribute = attributeMap.get(schemaAttribute.name);
    if (!attribute) return false;
    return !(
      schemaAttribute.value &&
      schemaAttribute.value !== staticTextValue(attribute)
    );
  });
}

function isParent(path: readonly Node[], elements: string[]): boolean {
  for (let i = path.length - 1; i >= 0; i--) {
    const parent = path[i];
    // Unknown, so don't warn.
    if (parent.type === "SvelteElement") return true;
    if (parent.type === "RegularElement")
      return elements.includes(parent.name as string);
  }
  return false;
}

function validateAriaAttributeValue(
  attribute: AST.Attribute,
  name: string,
  schema: { readonly type: string; readonly values?: readonly string[] },
  raw: string | true | null,
  warn: Warn,
): void {
  if (raw === null) return;
  const value = raw === true ? "" : raw;
  switch (schema.type) {
    case "id":
    case "string":
      if (value === "") {
        warn(
          attribute,
          "a11y_incorrect_aria_attribute_type",
          a11y_incorrect_aria_attribute_type(name, "non-empty string"),
        );
      }
      break;
    case "number":
      if (value === "" || Number.isNaN(Number(value))) {
        warn(
          attribute,
          "a11y_incorrect_aria_attribute_type",
          a11y_incorrect_aria_attribute_type(name, "number"),
        );
      }
      break;
    case "boolean":
      if (value !== "true" && value !== "false") {
        warn(
          attribute,
          "a11y_incorrect_aria_attribute_type_boolean",
          a11y_incorrect_aria_attribute_type_boolean(name),
        );
      }
      break;
    case "idlist":
      if (value === "") {
        warn(
          attribute,
          "a11y_incorrect_aria_attribute_type_idlist",
          a11y_incorrect_aria_attribute_type_idlist(name),
        );
      }
      break;
    case "integer":
      if (value === "" || !Number.isInteger(Number(value))) {
        warn(
          attribute,
          "a11y_incorrect_aria_attribute_type_integer",
          a11y_incorrect_aria_attribute_type_integer(name),
        );
      }
      break;
    case "token": {
      const values = schema.values ?? [];
      if (!values.includes(value.toLowerCase())) {
        warn(
          attribute,
          "a11y_incorrect_aria_attribute_type_token",
          a11y_incorrect_aria_attribute_type_token(
            name,
            list(values.map((v) => `"${v}"`)),
          ),
        );
      }
      break;
    }
    case "tokenlist": {
      const values = schema.values ?? [];
      if (
        value
          .toLowerCase()
          .split(WHITESPACES)
          .some((token) => !values.includes(token))
      ) {
        warn(
          attribute,
          "a11y_incorrect_aria_attribute_type_tokenlist",
          a11y_incorrect_aria_attribute_type_tokenlist(
            name,
            list(values.map((v) => `"${v}"`)),
          ),
        );
      }
      break;
    }
    case "tristate":
      if (value !== "true" && value !== "false" && value !== "mixed") {
        warn(
          attribute,
          "a11y_incorrect_aria_attribute_type_tristate",
          a11y_incorrect_aria_attribute_type_tristate(name),
        );
      }
      break;
  }
}

function warnMissingAttribute(
  node: Element,
  attributes: string[],
  warn: Warn,
  name = node.name,
): void {
  const article =
    STARTS_WITH_VOWEL.test(attributes[0]) || attributes[0] === "href"
      ? "an"
      : "a";
  const sequence =
    attributes.length > 1
      ? `${attributes.slice(0, -1).join(", ")} or ${attributes[attributes.length - 1]}`
      : attributes[0];
  warn(
    node,
    "a11y_missing_attribute",
    a11y_missing_attribute(name, article, sequence),
  );
}
