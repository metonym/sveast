const RESERVED_WORDS = new Set(
  "abstract accessor arguments as asserts async await break case catch class const continue debugger declare default delete do else enum eval export extends false finally for function get global if implements import in infer instanceof interface intrinsic is keyof let module namespace new null of out override package private protected public readonly return satisfies set static super switch this throw true try type typeof unique var void while with yield".split(
    " ",
  ),
);
const STANDALONE_WORDS = new Set(
  "any bigint boolean false never null number object string symbol true undefined unknown void".split(
    " ",
  ),
);
const MODIFIER_KEYS = new Set(
  "get set new readonly static public private protected".split(" "),
);

const SPACE = 32;
const TAB = 9;
const QUOTE = 34;
const APOSTROPHE = 39;
const PAREN_L = 40;
const MINUS = 45;
const DOT = 46;
const BACKSLASH = 92;
const BRACKET_L = 91;
const BRACE_L = 123;
const BRACE_R = 125;
const LT = 60;

function isWordStart(code: number): boolean {
  return (
    (code >= 97 && code <= 122) ||
    (code >= 65 && code <= 90) ||
    code === 95 ||
    code === 36
  );
}

function isDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

function isWordPart(code: number): boolean {
  return isWordStart(code) || isDigit(code);
}

class CommonTypeReader {
  readonly text: string;
  pos = 0;

  constructor(text: string) {
    this.text = text;
  }

  readAll(): boolean {
    if (!this.type()) return false;
    this.peek();
    return this.pos === this.text.length;
  }

  peek(): number {
    const text = this.text;
    let pos = this.pos;
    let code = text.charCodeAt(pos);
    while (code === SPACE || code === TAB) code = text.charCodeAt(++pos);
    this.pos = pos;
    return code;
  }

  eat(char: string): boolean {
    if (this.peek() !== char.charCodeAt(0)) return false;
    this.pos++;
    return true;
  }

  word(): string | undefined {
    if (!isWordStart(this.peek())) return undefined;
    const start = this.pos;
    let end = start + 1;
    while (isWordPart(this.text.charCodeAt(end))) end++;
    this.pos = end;
    return this.text.slice(start, end);
  }

  name(): boolean {
    const word = this.word();
    return word !== undefined && !RESERVED_WORDS.has(word);
  }

  string(): boolean {
    const quote = this.peek();
    if (quote !== QUOTE && quote !== APOSTROPHE) return false;
    const text = this.text;
    for (let i = this.pos + 1; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code === quote) {
        this.pos = i + 1;
        return true;
      }
      if (
        code === BACKSLASH ||
        code === 10 ||
        code === 13 ||
        code === 0x2028 ||
        code === 0x2029
      ) {
        return false;
      }
    }
    return false;
  }

  number(): boolean {
    const text = this.text;
    let i = this.pos;
    if (text.charCodeAt(i) === MINUS) i++;
    const digits = i;
    while (isDigit(text.charCodeAt(i))) i++;
    if (i === digits || (i - digits > 1 && text.charCodeAt(digits) === 48)) {
      return false;
    }
    if (text.charCodeAt(i) === DOT) {
      const fraction = ++i;
      while (isDigit(text.charCodeAt(i))) i++;
      if (i === fraction) return false;
    }
    const next = text.charCodeAt(i);
    if (isWordPart(next) || next === DOT) return false;
    this.pos = i;
    return true;
  }

  type(): boolean {
    if (this.peek() === PAREN_L) {
      const start = this.pos;
      if (this.functionType()) return true;
      this.pos = start;
    }
    do {
      do {
        if (!this.operatorType()) return false;
      } while (this.eat("&"));
    } while (this.eat("|"));
    return true;
  }

  operatorType(): boolean {
    const start = this.pos;
    if (this.word() === "keyof") return this.operatorType();
    this.pos = start;
    if (!this.primaryType()) return false;
    while (this.eat("[")) {
      if (this.eat("]")) continue;
      if (!this.type() || !this.eat("]")) return false;
    }
    return true;
  }

  primaryType(): boolean {
    const code = this.peek();
    if (code === PAREN_L) {
      this.pos++;
      return this.type() && this.eat(")");
    }
    if (code === BRACE_L) return this.objectType();
    if (code === BRACKET_L) return this.tupleType();
    if (code === QUOTE || code === APOSTROPHE) return this.string();
    if (code === MINUS || isDigit(code)) return this.number();
    const word = this.word();
    if (word === undefined) return false;
    if (word === "typeof") return this.typeQuery();
    if (word === "import") return this.importType(true);
    if (STANDALONE_WORDS.has(word)) {
      const next = this.peek();
      return next !== DOT && next !== LT;
    }
    if (RESERVED_WORDS.has(word)) return false;
    while (this.eat(".")) {
      if (this.word() === undefined) return false;
    }
    return !this.eat("<") || this.typeArguments();
  }

  typeArguments(): boolean {
    do {
      if (!this.type()) return false;
    } while (this.eat(","));
    return this.eat(">");
  }

  typeQuery(): boolean {
    const start = this.pos;
    if (this.word() === "import") return this.importType(false);
    this.pos = start;
    do {
      if (!this.name()) return false;
    } while (this.eat("."));
    return true;
  }

  importType(allowTypeArguments: boolean): boolean {
    if (!this.eat("(") || !this.string() || !this.eat(")")) return false;
    while (this.eat(".")) {
      if (!this.name()) return false;
    }
    return !allowTypeArguments || !this.eat("<") || this.typeArguments();
  }

  objectType(): boolean {
    this.pos++;
    while (!this.eat("}")) {
      if (!this.typeMember()) return false;
      if (!this.eat(";") && !this.eat(",") && this.peek() !== BRACE_R) {
        return false;
      }
    }
    return true;
  }

  typeMember(): boolean {
    const code = this.peek();
    if (this.eat("[")) {
      const next = this.peek();
      if (next === QUOTE || next === APOSTROPHE) {
        if (!this.string() || !this.eat("]")) return false;
      } else {
        return (
          this.name() &&
          this.eat(":") &&
          this.type() &&
          this.eat("]") &&
          this.eat(":") &&
          this.type()
        );
      }
    } else if (code === QUOTE || code === APOSTROPHE) {
      if (!this.string()) return false;
    } else {
      const key = this.word();
      if (key === undefined || MODIFIER_KEYS.has(key)) return false;
    }
    this.eat("?");
    return this.eat(":") && this.type();
  }

  tupleType(): boolean {
    this.pos++;
    if (this.eat("]")) return true;
    do {
      if (!this.type()) return false;
    } while (this.eat(","));
    return this.eat("]");
  }

  functionType(): boolean {
    this.pos++;
    if (!this.eat(")")) {
      const names = new Set<string>();
      for (;;) {
        this.peek();
        const rest = this.text.startsWith("...", this.pos);
        if (rest) this.pos += 3;
        const name = this.word();
        if (name === undefined || RESERVED_WORDS.has(name) || names.has(name)) {
          return false;
        }
        names.add(name);
        if (!rest) this.eat("?");
        if (!this.eat(":") || !this.type()) return false;
        if (rest || !this.eat(",")) break;
      }
      if (!this.eat(")")) return false;
    }
    this.peek();
    if (!this.text.startsWith("=>", this.pos)) return false;
    this.pos += 2;
    return this.type();
  }
}

/**
 * Whether `text` is one of the common shapes of a JSDoc type, read without
 * the TypeScript parser, whose first calls cost milliseconds. `true` means
 * it's certainly one valid type; `false` means "ask the parser".
 */
export function isCommonType(text: string): boolean {
  return new CommonTypeReader(text).readAll();
}
