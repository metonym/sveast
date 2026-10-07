const WINDOWS_1252 = [
  8364, 129, 8218, 402, 8222, 8230, 8224, 8225, 710, 8240, 352, 8249, 338, 141,
  381, 143, 144, 8216, 8217, 8220, 8221, 8226, 8211, 8212, 732, 8482, 353, 8250,
  339, 157, 382, 376,
];

const REGEX_ENTITY_SEPARATOR = /[:!]/;

export interface EntityNames {
  table: Map<string, number>;
  longest: number;
}

export function lazyEntityNames(encoded: string): () => EntityNames {
  let names: EntityNames | undefined;
  return () => {
    names ??= decodeEntityNames(encoded);
    return names;
  };
}

function decodeEntityNames(encoded: string): EntityNames {
  const table = new Map<string, number>();
  let longest = 0;
  let name = "";
  for (const entry of encoded.split(" ")) {
    const separator = entry.search(REGEX_ENTITY_SEPARATOR);
    name =
      name.slice(0, Number.parseInt(entry[0], 36)) + entry.slice(1, separator);
    const code = Number.parseInt(entry.slice(separator + 1), 36);
    table.set(`${name};`, code);
    if (entry[separator] === "!") table.set(name, code);
    longest = Math.max(longest, name.length + 1);
  }
  return { table, longest };
}

export const xmlEntityNames = lazyEntityNames(
  "0amp!12 1pos:13 0gt!1q 0lt!1o 0quot!y",
);

const isDigit = (code: number) => code >= 48 && code <= 57;
const isHexDigit = (code: number) =>
  isDigit(code) || (code >= 65 && code <= 70) || (code >= 97 && code <= 102);
const isAlphanumeric = (code: number) =>
  isDigit(code) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);

let referenceEnd = 0;

function readReference(
  html: string,
  start: number,
  inAttribute: boolean,
  entityNames: () => EntityNames,
) {
  if (html.charCodeAt(start) === 35) {
    const hex = (html.charCodeAt(start + 1) | 32) === 120;
    const digitsStart = start + (hex ? 2 : 1);
    let end = digitsStart;
    while (
      end < html.length &&
      (hex ? isHexDigit : isDigit)(html.charCodeAt(end))
    ) {
      end++;
    }
    if (end === digitsStart) return 0;
    referenceEnd = html.charCodeAt(end) === 59 ? end + 1 : end;
    return Number.parseInt(html.slice(digitsStart, end), hex ? 16 : 10);
  }

  const { table: names, longest } = entityNames();
  let runEnd = start;
  while (runEnd - start < longest && isAlphanumeric(html.charCodeAt(runEnd))) {
    runEnd++;
  }
  if (html.charCodeAt(runEnd) === 59) {
    const code = names.get(html.slice(start, runEnd + 1));
    if (code !== undefined) {
      referenceEnd = runEnd + 1;
      return code;
    }
  }
  for (let end = runEnd; end > start; end--) {
    const code = names.get(html.slice(start, end));
    if (code === undefined) continue;
    if (inAttribute) {
      const next = html.charCodeAt(end);
      if (isAlphanumeric(next) || next === 95 || next === 61) continue;
    }
    referenceEnd = end;
    return code;
  }
  return 0;
}

function validateCode(code: number, inAttribute: boolean): number {
  if (code === 10 && !inAttribute) return 32;
  if (code < 128) return code;
  if (code <= 159) return WINDOWS_1252[code - 128];
  if (code >= 55296 && code <= 57343) return 0;
  if (code <= 196607) return code;
  if ((code >= 917504 && code <= 917631) || (code >= 917760 && code <= 917999))
    return code;
  return 0;
}

export function decodeCharacterReferences(
  html: string,
  inAttribute: boolean,
  entityNames: () => EntityNames,
): string {
  let amp = html.indexOf("&");
  if (amp === -1) return html;

  let out = "";
  let copied = 0;
  while (amp !== -1) {
    const code = readReference(html, amp + 1, inAttribute, entityNames);
    if (code) {
      out +=
        html.slice(copied, amp) +
        String.fromCodePoint(validateCode(code, inAttribute));
      copied = referenceEnd;
    }
    amp = html.indexOf("&", code ? copied : amp + 1);
  }
  return out + html.slice(copied);
}
