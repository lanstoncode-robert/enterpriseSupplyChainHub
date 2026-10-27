import { GraphQLSyntaxError } from './errors.js';

const PUNCTUATORS = new Set(['!', '$', '&', '(', ')', ':', '=', '@', '[', ']', '{', '|', '}']);

export const TokenKind = Object.freeze({
  NAME: 'NAME',
  INT: 'INT',
  FLOAT: 'FLOAT',
  STRING: 'STRING',
  BLOCK_STRING: 'BLOCK_STRING',
  PUNCT: 'PUNCT',
  EOF: 'EOF',
});

const isDigit = (ch) => ch >= '0' && ch <= '9';
const isNameStart = (ch) => (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
const isNameContinue = (ch) => isNameStart(ch) || isDigit(ch);

function token(kind, value, start, end, line, column) {
  return { kind, value, start, end, line, column };
}

/**
 * Hand-written GraphQL lexer. Supports names, numbers, single-line strings,
 * block strings (with the spec dedent algorithm), comments, commas-as-ignored,
 * and source positions for validation and execution errors.
 */
export class Lexer {
  constructor(source) {
    if (typeof source !== 'string') throw new TypeError('GraphQL source must be a string');
    this.source = source;
    this.length = source.length;
    this.pos = 0;
    this.line = 1;
    this.lineStart = 0;
  }

  tokenize() {
    const tokens = [];
    for (;;) {
      const next = this.next();
      tokens.push(next);
      if (next.kind === TokenKind.EOF) return tokens;
    }
  }

  error(message) {
    return new GraphQLSyntaxError(message, {
      line: this.line,
      column: this.pos - this.lineStart + 1,
    });
  }

  skipIgnored() {
    while (this.pos < this.length) {
      const ch = this.source[this.pos];
      if (ch === ' ' || ch === '\t' || ch === ',' || ch === '\uFEFF') {
        this.pos += 1;
      } else if (ch === '\n') {
        this.pos += 1;
        this.line += 1;
        this.lineStart = this.pos;
      } else if (ch === '\r') {
        this.pos += 1;
        if (this.source[this.pos] === '\n') this.pos += 1;
        this.line += 1;
        this.lineStart = this.pos;
      } else if (ch === '#') {
        while (this.pos < this.length && this.source[this.pos] !== '\n' && this.source[this.pos] !== '\r') {
          this.pos += 1;
        }
      } else {
        return;
      }
    }
  }

  next() {
    this.skipIgnored();
    const start = this.pos;
    const line = this.line;
    const column = this.pos - this.lineStart + 1;
    if (this.pos >= this.length) {
      return token(TokenKind.EOF, '<EOF>', start, start, line, column);
    }

    const ch = this.source[this.pos];

    if (ch === '.' && this.source.startsWith('...', this.pos)) {
      this.pos += 3;
      return token(TokenKind.PUNCT, '...', start, this.pos, line, column);
    }
    if (PUNCTUATORS.has(ch)) {
      this.pos += 1;
      return token(TokenKind.PUNCT, ch, start, this.pos, line, column);
    }
    if (ch === '"') {
      if (this.source.startsWith('"""', this.pos)) return this.readBlockString(line, column);
      return this.readString(line, column);
    }
    if (ch === '-' || isDigit(ch)) return this.readNumber(line, column);
    if (isNameStart(ch)) return this.readName(line, column);

    throw new GraphQLSyntaxError(`Unexpected character ${JSON.stringify(ch)}.`, { line, column });
  }

  readName(line, column) {
    const start = this.pos;
    this.pos += 1;
    while (this.pos < this.length && isNameContinue(this.source[this.pos])) this.pos += 1;
    return token(TokenKind.NAME, this.source.slice(start, this.pos), start, this.pos, line, column);
  }

  readNumber(line, column) {
    const start = this.pos;
    if (this.source[this.pos] === '-') this.pos += 1;
    if (this.source[this.pos] === '0') {
      this.pos += 1;
      if (isDigit(this.source[this.pos] ?? '')) throw this.error('Invalid number, unexpected digit after 0.');
    } else {
      if (!isDigit(this.source[this.pos] ?? '')) throw this.error('Invalid number, expected digit.');
      while (isDigit(this.source[this.pos] ?? '')) this.pos += 1;
    }

    let kind = TokenKind.INT;
    if (this.source[this.pos] === '.') {
      kind = TokenKind.FLOAT;
      this.pos += 1;
      if (!isDigit(this.source[this.pos] ?? '')) throw this.error('Invalid number, expected digit after decimal point.');
      while (isDigit(this.source[this.pos] ?? '')) this.pos += 1;
    }
    if (this.source[this.pos] === 'e' || this.source[this.pos] === 'E') {
      kind = TokenKind.FLOAT;
      this.pos += 1;
      if (this.source[this.pos] === '+' || this.source[this.pos] === '-') this.pos += 1;
      if (!isDigit(this.source[this.pos] ?? '')) throw this.error('Invalid number, expected digit in exponent.');
      while (isDigit(this.source[this.pos] ?? '')) this.pos += 1;
    }
    if (isNameStart(this.source[this.pos] ?? '')) {
      throw this.error(`Invalid number, unexpected character ${JSON.stringify(this.source[this.pos])}.`);
    }
    return token(kind, this.source.slice(start, this.pos), start, this.pos, line, column);
  }

  readString(line, column) {
    const start = this.pos;
    this.pos += 1;
    let value = '';
    while (this.pos < this.length) {
      const ch = this.source[this.pos];
      if (ch === '"') {
        this.pos += 1;
        return token(TokenKind.STRING, value, start, this.pos, line, column);
      }
      if (ch === '\n' || ch === '\r') throw this.error('Unterminated string.');
      if (ch === '\\') {
        this.pos += 1;
        const escaped = this.source[this.pos];
        switch (escaped) {
          case '"': value += '"'; this.pos += 1; break;
          case '\\': value += '\\'; this.pos += 1; break;
          case '/': value += '/'; this.pos += 1; break;
          case 'b': value += '\b'; this.pos += 1; break;
          case 'f': value += '\f'; this.pos += 1; break;
          case 'n': value += '\n'; this.pos += 1; break;
          case 'r': value += '\r'; this.pos += 1; break;
          case 't': value += '\t'; this.pos += 1; break;
          case 'u': {
            const hex = this.source.slice(this.pos + 1, this.pos + 5);
            if (!/^[0-9A-Fa-f]{4}$/.test(hex)) throw this.error('Invalid unicode escape sequence.');
            value += String.fromCharCode(parseInt(hex, 16));
            this.pos += 5;
            break;
          }
          default:
            throw this.error(`Invalid escape sequence \\${escaped ?? ''}.`);
        }
      } else {
        value += ch;
        this.pos += 1;
      }
    }
    throw this.error('Unterminated string.');
  }

  readBlockString(line, column) {
    const start = this.pos;
    this.pos += 3;
    let raw = '';
    while (this.pos < this.length) {
      if (this.source.startsWith('"""', this.pos)) {
        this.pos += 3;
        return token(TokenKind.BLOCK_STRING, dedentBlockString(raw), start, this.pos, line, column);
      }
      if (this.source.startsWith('\\"""', this.pos)) {
        raw += '"""';
        this.pos += 4;
        continue;
      }
      const ch = this.source[this.pos];
      if (ch === '\n') {
        this.line += 1;
        this.pos += 1;
        this.lineStart = this.pos;
        raw += '\n';
        continue;
      }
      if (ch === '\r') {
        this.pos += 1;
        if (this.source[this.pos] === '\n') this.pos += 1;
        this.line += 1;
        this.lineStart = this.pos;
        raw += '\n';
        continue;
      }
      raw += ch;
      this.pos += 1;
    }
    throw this.error('Unterminated block string.');
  }
}

/** Implements the GraphQL spec BlockStringValue() dedent algorithm. */
export function dedentBlockString(raw) {
  const lines = raw.split('\n');
  let commonIndent = null;
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    let indent = 0;
    while (indent < line.length && (line[indent] === ' ' || line[indent] === '\t')) indent += 1;
    if (indent < line.length && (commonIndent === null || indent < commonIndent)) commonIndent = indent;
  }
  if (commonIndent !== null && commonIndent > 0) {
    for (let i = 1; i < lines.length; i += 1) lines[i] = lines[i].slice(commonIndent);
  }
  while (lines.length > 0 && lines[0].trim() === '') lines.shift();
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
  return lines.join('\n');
}

export function lex(source) {
  return new Lexer(source).tokenize();
}
