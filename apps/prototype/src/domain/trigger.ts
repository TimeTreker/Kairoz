// Policy trigger expressions, e.g. `brake_pressure > 80 AND vehicle_speed > 30`.
//
//   expr    := or
//   or      := and (('OR' | '||') and)*
//   and     := unary (('AND' | '&&') unary)*
//   unary   := ('NOT' | '!') unary | compare
//   compare := operand (('==' | '=' | '!=' | '>' | '>=' | '<' | '<=') operand)?
//   operand := NUMBER | STRING | 'true' | 'false' | SIGNAL | '(' expr ')'
//
// SIGNAL is a dotted identifier such as `chassis.brake_pressure`. A bare signal is a boolean test.
// Comparisons take signals or literals (never sub-expressions); ordering operators compare
// signals and numbers only. Keywords are case-insensitive. Only validation and signal
// extraction live here; evaluation happens on the vehicle.

export type TriggerNode =
  | { kind: 'or' | 'and'; items: TriggerNode[] }
  | { kind: 'not'; item: TriggerNode }
  | { kind: 'compare'; op: CompareOp; left: TriggerNode; right: TriggerNode }
  | { kind: 'signal'; name: string }
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'boolean'; value: boolean };

export type CompareOp = '==' | '!=' | '>' | '>=' | '<' | '<=';

export interface TriggerError {
  message: string;
  position: number;
}

export type TriggerParseResult =
  | { ok: true; ast: TriggerNode; signals: string[] }
  | { ok: false; error: TriggerError };

export const TRIGGER_MAX_LENGTH = 2000;
export const TRIGGER_MAX_DEPTH = 32;

type Token =
  | { type: 'number'; value: number; pos: number }
  | { type: 'string'; value: string; pos: number }
  | { type: 'ident'; value: string; pos: number }
  | { type: 'op'; value: string; pos: number }
  | { type: 'end'; pos: number };

class ParseFailure extends Error {
  readonly position: number;
  constructor(message: string, position: number) {
    super(message);
    this.position = position;
  }
}

const IDENT = /[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/y;
const NUMBER = /-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
const OPERATORS = ['>=', '<=', '==', '!=', '&&', '||', '>', '<', '=', '!', '(', ')'];

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;
  while (pos < source.length) {
    const ch = source[pos]!;
    if (/\s/.test(ch)) {
      pos++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const end = source.indexOf(ch, pos + 1);
      if (end < 0) throw new ParseFailure('unterminated string', pos);
      tokens.push({ type: 'string', value: source.slice(pos + 1, end), pos });
      pos = end + 1;
      continue;
    }
    NUMBER.lastIndex = pos;
    const num = NUMBER.exec(source);
    // A leading '-' is a sign only where an operand may start.
    const prev = tokens.at(-1);
    const operandExpected =
      !prev || (prev.type === 'op' && prev.value !== ')') || (prev.type === 'ident' && /^(AND|OR|NOT)$/i.test(prev.value));
    if (num && (ch !== '-' || operandExpected)) {
      const value = Number(num[0]);
      if (!Number.isFinite(value)) throw new ParseFailure('number out of range', pos);
      tokens.push({ type: 'number', value, pos });
      pos += num[0].length;
      continue;
    }
    IDENT.lastIndex = pos;
    const ident = IDENT.exec(source);
    if (ident) {
      tokens.push({ type: 'ident', value: ident[0], pos });
      pos += ident[0].length;
      continue;
    }
    const op = OPERATORS.find((o) => source.startsWith(o, pos));
    if (op) {
      tokens.push({ type: 'op', value: op, pos });
      pos += op.length;
      continue;
    }
    throw new ParseFailure(`unexpected character ${JSON.stringify(ch)}`, pos);
  }
  tokens.push({ type: 'end', pos: source.length });
  return tokens;
}

const COMPARE: Record<string, CompareOp> = { '==': '==', '=': '==', '!=': '!=', '>': '>', '>=': '>=', '<': '<', '<=': '<=' };

class Parser {
  private readonly tokens: Token[];
  private index = 0;
  private depth = 0;
  readonly signals = new Set<string>();

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token {
    return this.tokens[this.index]!;
  }

  private next(): Token {
    return this.tokens[this.index++]!;
  }

  private isKeyword(token: Token, keyword: string): boolean {
    return token.type === 'ident' && token.value.toUpperCase() === keyword;
  }

  private isOp(token: Token, value: string): boolean {
    return token.type === 'op' && token.value === value;
  }

  parse(): TriggerNode {
    const node = this.or();
    const rest = this.peek();
    if (rest.type !== 'end') throw new ParseFailure('unexpected token after expression', rest.pos);
    return node;
  }

  private or(): TriggerNode {
    const items = [this.and()];
    while (this.isKeyword(this.peek(), 'OR') || this.isOp(this.peek(), '||')) {
      this.next();
      items.push(this.and());
    }
    return items.length === 1 ? items[0]! : { kind: 'or', items };
  }

  private and(): TriggerNode {
    const items = [this.unary()];
    while (this.isKeyword(this.peek(), 'AND') || this.isOp(this.peek(), '&&')) {
      this.next();
      items.push(this.unary());
    }
    return items.length === 1 ? items[0]! : { kind: 'and', items };
  }

  private nested<T>(token: Token, parse: () => T): T {
    if (++this.depth > TRIGGER_MAX_DEPTH) throw new ParseFailure(`nesting deeper than ${TRIGGER_MAX_DEPTH}`, token.pos);
    try {
      return parse();
    } finally {
      this.depth--;
    }
  }

  private unary(): TriggerNode {
    const token = this.peek();
    if (this.isKeyword(token, 'NOT') || this.isOp(token, '!')) {
      this.next();
      return { kind: 'not', item: this.nested(token, () => this.unary()) };
    }
    return this.compare();
  }

  private compare(): TriggerNode {
    const left = this.operand();
    const token = this.peek();
    if (token.type === 'op' && COMPARE[token.value]) {
      this.next();
      const right = this.operand();
      const op = COMPARE[token.value]!;
      const values = ['signal', 'number', 'string', 'boolean'];
      if (!values.includes(left.kind) || !values.includes(right.kind)) {
        throw new ParseFailure('compare signals or literals, not sub-expressions', token.pos);
      }
      if (left.kind !== 'signal' && right.kind !== 'signal') {
        throw new ParseFailure('a comparison must involve at least one signal', token.pos);
      }
      const ordering = op !== '==' && op !== '!=';
      const textual = (n: TriggerNode) => n.kind === 'string' || n.kind === 'boolean';
      if (ordering && (textual(left) || textual(right))) {
        throw new ParseFailure(`${op} compares numbers; use == or != for text and booleans`, token.pos);
      }
      return { kind: 'compare', op, left, right };
    }
    if (left.kind === 'number' || left.kind === 'string') {
      throw new ParseFailure('a literal is not a condition on its own', token.pos);
    }
    return left;
  }

  private operand(): TriggerNode {
    const token = this.next();
    switch (token.type) {
      case 'number':
        return { kind: 'number', value: token.value };
      case 'string':
        return { kind: 'string', value: token.value };
      case 'ident': {
        const upper = token.value.toUpperCase();
        if (upper === 'TRUE' || upper === 'FALSE') return { kind: 'boolean', value: upper === 'TRUE' };
        if (upper === 'AND' || upper === 'OR' || upper === 'NOT') {
          throw new ParseFailure(`unexpected keyword ${token.value}`, token.pos);
        }
        this.signals.add(token.value);
        return { kind: 'signal', name: token.value };
      }
      case 'op':
        if (token.value === '(') {
          const inner = this.nested(token, () => this.or());
          const close = this.next();
          if (!this.isOp(close, ')')) throw new ParseFailure('missing closing parenthesis', close.pos);
          return inner;
        }
        throw new ParseFailure(`unexpected ${token.value}`, token.pos);
      case 'end':
        throw new ParseFailure('unexpected end of expression', token.pos);
    }
  }
}

export function parseTrigger(source: string): TriggerParseResult {
  if (source.trim().length === 0) return { ok: false, error: { message: 'trigger is empty', position: 0 } };
  if (source.length > TRIGGER_MAX_LENGTH) {
    return { ok: false, error: { message: `trigger exceeds ${TRIGGER_MAX_LENGTH} characters`, position: TRIGGER_MAX_LENGTH } };
  }
  try {
    const parser = new Parser(tokenize(source));
    const ast = parser.parse();
    if (parser.signals.size === 0) return { ok: false, error: { message: 'trigger references no signal', position: 0 } };
    return { ok: true, ast, signals: [...parser.signals].sort() };
  } catch (e) {
    if (e instanceof ParseFailure) return { ok: false, error: { message: e.message, position: e.position } };
    throw e;
  }
}
