import { TokenKind, lex } from './lexer.js';
import { GraphQLSyntaxError } from './errors.js';

const TYPE_SYSTEM_KEYWORDS = new Set([
  'schema', 'scalar', 'type', 'interface', 'union', 'enum', 'input', 'directive', 'extend',
]);

function describe(token) {
  if (token.kind === TokenKind.EOF) return '<EOF>';
  if (token.kind === TokenKind.PUNCT) return `"${token.value}"`;
  return `${token.kind} "${token.value}"`;
}

/**
 * Recursive-descent parser for executable GraphQL documents and the SDL
 * subset used by this project (objects, inputs, enums, scalars, directives,
 * schema definitions, and object extensions).
 */
export class Parser {
  constructor(source) {
    this.source = source;
    this.tokens = lex(source);
    this.index = 0;
  }

  get current() {
    return this.tokens[this.index];
  }

  peek(offset = 1) {
    return this.tokens[Math.min(this.index + offset, this.tokens.length - 1)];
  }

  advance() {
    const token = this.current;
    if (token.kind !== TokenKind.EOF) this.index += 1;
    return token;
  }

  loc(token = this.current) {
    return { line: token.line, column: token.column, start: token.start, end: token.end };
  }

  syntaxError(message, token = this.current) {
    return new GraphQLSyntaxError(message, token);
  }

  expectPunct(value) {
    const token = this.current;
    if (token.kind !== TokenKind.PUNCT || token.value !== value) {
      throw this.syntaxError(`Expected "${value}", found ${describe(token)}.`);
    }
    return this.advance();
  }

  skipPunct(value) {
    if (this.current.kind === TokenKind.PUNCT && this.current.value === value) {
      this.advance();
      return true;
    }
    return false;
  }

  expectName(value) {
    const token = this.current;
    if (token.kind !== TokenKind.NAME) {
      throw this.syntaxError(`Expected a name${value ? ` "${value}"` : ''}, found ${describe(token)}.`);
    }
    if (value !== undefined && token.value !== value) {
      throw this.syntaxError(`Expected "${value}", found ${describe(token)}.`);
    }
    this.advance();
    return token.value;
  }

  peekName(value) {
    return this.current.kind === TokenKind.NAME && this.current.value === value;
  }

  parseDocument() {
    const start = this.loc();
    const definitions = [];
    while (this.current.kind !== TokenKind.EOF) {
      definitions.push(this.parseDefinition());
    }
    return { kind: 'Document', definitions, loc: start };
  }

  parseDefinition() {
    if (this.current.kind === TokenKind.PUNCT && this.current.value === '{') {
      return this.parseOperationDefinition(true);
    }
    if (this.current.kind === TokenKind.STRING || this.current.kind === TokenKind.BLOCK_STRING) {
      return this.parseTypeSystemDefinition();
    }
    if (this.current.kind !== TokenKind.NAME) {
      throw this.syntaxError(`Unexpected ${describe(this.current)}.`);
    }
    const keyword = this.current.value;
    if (keyword === 'query' || keyword === 'mutation' || keyword === 'subscription') {
      return this.parseOperationDefinition(false);
    }
    if (keyword === 'fragment') return this.parseFragmentDefinition();
    if (TYPE_SYSTEM_KEYWORDS.has(keyword)) return this.parseTypeSystemDefinition();
    throw this.syntaxError(`Unexpected name "${keyword}"; expected an operation or type definition.`);
  }

  parseOperationDefinition(shorthand) {
    const start = this.loc();
    if (shorthand) {
      return {
        kind: 'OperationDefinition',
        operation: 'query',
        name: null,
        variableDefinitions: [],
        directives: [],
        selectionSet: this.parseSelectionSet(),
        loc: start,
      };
    }
    const operation = this.expectName();
    const name = this.current.kind === TokenKind.NAME ? this.expectName() : null;
    const variableDefinitions = this.parseVariableDefinitions();
    const directives = this.parseDirectives();
    const selectionSet = this.parseSelectionSet();
    return { kind: 'OperationDefinition', operation, name, variableDefinitions, directives, selectionSet, loc: start };
  }

  parseVariableDefinitions() {
    const definitions = [];
    if (!this.skipPunct('(')) return definitions;
    if (this.current.kind === TokenKind.PUNCT && this.current.value === ')') {
      throw this.syntaxError('Variable definitions cannot be empty.');
    }
    while (!this.skipPunct(')')) {
      const start = this.loc();
      this.expectPunct('$');
      const name = this.expectName();
      this.expectPunct(':');
      const type = this.parseTypeReference();
      let defaultValue = null;
      if (this.skipPunct('=')) defaultValue = this.parseValueLiteral(true);
      const directives = this.parseDirectives();
      definitions.push({ kind: 'VariableDefinition', name, type, defaultValue, directives, loc: start });
    }
    return definitions;
  }

  parseSelectionSet() {
    const start = this.loc();
    this.expectPunct('{');
    const selections = [];
    if (this.current.kind === TokenKind.PUNCT && this.current.value === '}') {
      throw this.syntaxError('Selection sets must contain at least one field.');
    }
    while (!this.skipPunct('}')) {
      selections.push(this.parseSelection());
    }
    return { kind: 'SelectionSet', selections, loc: start };
  }

  parseSelection() {
    if (this.skipPunct('...')) {
      const start = this.loc();
      if (this.peekName('on')) {
        this.advance();
        const typeCondition = this.parseNamedType();
        const directives = this.parseDirectives();
        const selectionSet = this.parseSelectionSet();
        return { kind: 'InlineFragment', typeCondition, directives, selectionSet, loc: start };
      }
      if (this.current.kind === TokenKind.NAME) {
        const name = this.expectName();
        const directives = this.parseDirectives();
        return { kind: 'FragmentSpread', name, directives, loc: start };
      }
      const directives = this.parseDirectives();
      const selectionSet = this.parseSelectionSet();
      return { kind: 'InlineFragment', typeCondition: null, directives, selectionSet, loc: start };
    }
    return this.parseField();
  }

  parseField() {
    const start = this.loc();
    let name = this.expectName();
    let alias = null;
    if (this.skipPunct(':')) {
      alias = name;
      name = this.expectName();
    }
    const args = this.parseArguments();
    const directives = this.parseDirectives();
    const selectionSet = this.current.kind === TokenKind.PUNCT && this.current.value === '{'
      ? this.parseSelectionSet()
      : null;
    return { kind: 'Field', alias, name, arguments: args, directives, selectionSet, loc: start };
  }

  parseArguments() {
    const args = [];
    if (!this.skipPunct('(')) return args;
    if (this.current.kind === TokenKind.PUNCT && this.current.value === ')') {
      throw this.syntaxError('Argument lists cannot be empty.');
    }
    while (!this.skipPunct(')')) {
      const start = this.loc();
      const name = this.expectName();
      this.expectPunct(':');
      const value = this.parseValueLiteral(false);
      args.push({ kind: 'Argument', name, value, loc: start });
    }
    return args;
  }

  parseDirectives() {
    const directives = [];
    while (this.skipPunct('@')) {
      const start = this.loc();
      const name = this.expectName();
      const args = this.parseArguments();
      directives.push({ kind: 'Directive', name, arguments: args, loc: start });
    }
    return directives;
  }

  parseValueLiteral(isConst) {
    const token = this.current;
    const start = this.loc();
    if (token.kind === TokenKind.PUNCT) {
      if (token.value === '[') {
        this.advance();
        const values = [];
        while (!this.skipPunct(']')) values.push(this.parseValueLiteral(isConst));
        return { kind: 'ListValue', values, loc: start };
      }
      if (token.value === '{') {
        this.advance();
        const fields = [];
        while (!this.skipPunct('}')) {
          const fieldStart = this.loc();
          const name = this.expectName();
          this.expectPunct(':');
          const value = this.parseValueLiteral(isConst);
          fields.push({ kind: 'ObjectField', name, value, loc: fieldStart });
        }
        return { kind: 'ObjectValue', fields, loc: start };
      }
      if (token.value === '$' && !isConst) {
        this.advance();
        return { kind: 'Variable', name: this.expectName(), loc: start };
      }
    }
    if (token.kind === TokenKind.INT) {
      this.advance();
      return { kind: 'IntValue', value: token.value, loc: start };
    }
    if (token.kind === TokenKind.FLOAT) {
      this.advance();
      return { kind: 'FloatValue', value: token.value, loc: start };
    }
    if (token.kind === TokenKind.STRING || token.kind === TokenKind.BLOCK_STRING) {
      this.advance();
      return { kind: 'StringValue', value: token.value, block: token.kind === TokenKind.BLOCK_STRING, loc: start };
    }
    if (token.kind === TokenKind.NAME) {
      this.advance();
      if (token.value === 'true' || token.value === 'false') {
        return { kind: 'BooleanValue', value: token.value === 'true', loc: start };
      }
      if (token.value === 'null') return { kind: 'NullValue', loc: start };
      return { kind: 'EnumValue', value: token.value, loc: start };
    }
    throw this.syntaxError(`Unexpected ${describe(token)} in value position.`);
  }

  parseTypeReference() {
    const start = this.loc();
    let type;
    if (this.skipPunct('[')) {
      const ofType = this.parseTypeReference();
      this.expectPunct(']');
      type = { kind: 'ListType', type: ofType, loc: start };
    } else {
      type = this.parseNamedType();
    }
    if (this.skipPunct('!')) {
      type = { kind: 'NonNullType', type, loc: start };
    }
    return type;
  }

  parseNamedType() {
    const start = this.loc();
    const name = this.expectName();
    return { kind: 'NamedType', name, loc: start };
  }

  parseFragmentDefinition() {
    const start = this.loc();
    this.expectName('fragment');
    const name = this.expectName();
    if (name === 'on') throw this.syntaxError('Fragment name cannot be "on".');
    this.expectName('on');
    const typeCondition = this.parseNamedType();
    const directives = this.parseDirectives();
    const selectionSet = this.parseSelectionSet();
    return { kind: 'FragmentDefinition', name, typeCondition, directives, selectionSet, loc: start };
  }

  parseDescription() {
    if (this.current.kind === TokenKind.STRING || this.current.kind === TokenKind.BLOCK_STRING) {
      return this.advance().value;
    }
    return null;
  }

  parseTypeSystemDefinition() {
    const description = this.parseDescription();
    const start = this.loc();
    if (this.current.kind !== TokenKind.NAME) {
      throw this.syntaxError(`Expected a type system definition, found ${describe(this.current)}.`);
    }
    const keyword = this.current.value;
    if (keyword === 'extend') {
      this.advance();
      return this.parseExtension(start);
    }
    switch (keyword) {
      case 'schema': {
        this.advance();
        const directives = this.parseDirectives();
        this.expectPunct('{');
        const operationTypes = [];
        while (!this.skipPunct('}')) {
          const operation = this.expectName();
          if (!['query', 'mutation', 'subscription'].includes(operation)) {
            throw this.syntaxError(`Unknown schema operation "${operation}".`);
          }
          this.expectPunct(':');
          operationTypes.push({ operation, type: this.parseNamedType() });
        }
        return { kind: 'SchemaDefinition', description, directives, operationTypes, loc: start };
      }
      case 'scalar': {
        this.advance();
        const name = this.expectName();
        const directives = this.parseDirectives();
        return { kind: 'ScalarTypeDefinition', name, description, directives, loc: start };
      }
      case 'type': {
        this.advance();
        const name = this.expectName();
        const interfaces = this.parseImplementsInterfaces();
        const directives = this.parseDirectives();
        const fields = this.parseFieldDefinitions();
        return { kind: 'ObjectTypeDefinition', name, description, interfaces, directives, fields, loc: start };
      }
      case 'interface': {
        this.advance();
        const name = this.expectName();
        const interfaces = this.parseImplementsInterfaces();
        const directives = this.parseDirectives();
        const fields = this.parseFieldDefinitions();
        return { kind: 'InterfaceTypeDefinition', name, description, interfaces, directives, fields, loc: start };
      }
      case 'union': {
        this.advance();
        const name = this.expectName();
        const directives = this.parseDirectives();
        this.expectPunct('=');
        this.skipPunct('|');
        const types = [this.parseNamedType()];
        while (this.skipPunct('|')) types.push(this.parseNamedType());
        return { kind: 'UnionTypeDefinition', name, description, directives, types, loc: start };
      }
      case 'enum': {
        this.advance();
        const name = this.expectName();
        const directives = this.parseDirectives();
        this.expectPunct('{');
        const values = [];
        while (!this.skipPunct('}')) {
          const valueStart = this.loc();
          const valueDescription = this.parseDescription();
          const valueName = this.expectName();
          const valueDirectives = this.parseDirectives();
          values.push({ kind: 'EnumValueDefinition', name: valueName, description: valueDescription, directives: valueDirectives, loc: valueStart });
        }
        return { kind: 'EnumTypeDefinition', name, description, directives, values, loc: start };
      }
      case 'input': {
        this.advance();
        const name = this.expectName();
        const directives = this.parseDirectives();
        this.expectPunct('{');
        const fields = [];
        while (!this.skipPunct('}')) fields.push(this.parseInputValueDefinition());
        return { kind: 'InputObjectTypeDefinition', name, description, directives, fields, loc: start };
      }
      case 'directive': {
        this.advance();
        this.expectPunct('@');
        const name = this.expectName();
        const args = this.parseInputValueDefinitions();
        const repeatable = this.peekName('repeatable') ? Boolean(this.advance()) : false;
        this.expectName('on');
        this.skipPunct('|');
        const locations = [this.expectName()];
        while (this.skipPunct('|')) locations.push(this.expectName());
        return { kind: 'DirectiveDefinition', name, description, args, repeatable, locations, loc: start };
      }
      default:
        throw this.syntaxError(`Unsupported type system keyword "${keyword}".`);
    }
  }

  parseExtension(start) {
    const kind = this.expectName();
    if (kind === 'schema') {
      const directives = this.parseDirectives();
      const operationTypes = [];
      if (this.skipPunct('{')) {
        while (!this.skipPunct('}')) {
          const operation = this.expectName();
          this.expectPunct(':');
          operationTypes.push({ operation, type: this.parseNamedType() });
        }
      }
      return { kind: 'SchemaExtension', directives, operationTypes, loc: start };
    }
    const name = this.expectName();
    const directives = this.parseDirectives();
    if (kind === 'type' || kind === 'interface') {
      const fields = this.current.kind === TokenKind.PUNCT && this.current.value === '{'
        ? this.parseFieldDefinitions()
        : [];
      return { kind: kind === 'type' ? 'ObjectTypeExtension' : 'InterfaceTypeExtension', name, directives, fields, loc: start };
    }
    if (kind === 'enum' || kind === 'input') {
      const fields = this.current.kind === TokenKind.PUNCT && this.current.value === '{'
        ? (kind === 'input' ? this.parseInputValueDefinitions() : this.parseEnumValues())
        : [];
      return { kind: kind === 'input' ? 'InputObjectTypeExtension' : 'EnumTypeExtension', name, directives, fields, loc: start };
    }
    if (kind === 'scalar') {
      return { kind: 'ScalarTypeExtension', name, directives, loc: start };
    }
    throw this.syntaxError(`Unsupported extension kind "${kind}".`);
  }

  parseImplementsInterfaces() {
    const interfaces = [];
    if (!this.peekName('implements')) return interfaces;
    this.advance();
    this.skipPunct('&');
    interfaces.push(this.parseNamedType());
    while (this.skipPunct('&')) interfaces.push(this.parseNamedType());
    return interfaces;
  }

  parseFieldDefinitions() {
    this.expectPunct('{');
    const fields = [];
    if (this.current.kind === TokenKind.PUNCT && this.current.value === '}') {
      throw this.syntaxError('Object types must define at least one field.');
    }
    while (!this.skipPunct('}')) fields.push(this.parseFieldDefinition());
    return fields;
  }

  parseFieldDefinition() {
    const start = this.loc();
    const description = this.parseDescription();
    const name = this.expectName();
    const args = this.parseInputValueDefinitions();
    this.expectPunct(':');
    const type = this.parseTypeReference();
    const directives = this.parseDirectives();
    return { kind: 'FieldDefinition', name, description, arguments: args, type, directives, loc: start };
  }

  parseInputValueDefinitions() {
    const args = [];
    if (!this.skipPunct('(')) return args;
    if (this.current.kind === TokenKind.PUNCT && this.current.value === ')') {
      throw this.syntaxError('Input value definitions cannot be empty.');
    }
    while (!this.skipPunct(')')) args.push(this.parseInputValueDefinition());
    return args;
  }

  parseInputValueDefinition() {
    const start = this.loc();
    const description = this.parseDescription();
    const name = this.expectName();
    this.expectPunct(':');
    const type = this.parseTypeReference();
    let defaultValue = null;
    if (this.skipPunct('=')) defaultValue = this.parseValueLiteral(true);
    const directives = this.parseDirectives();
    return { kind: 'InputValueDefinition', name, description, type, defaultValue, directives, loc: start };
  }

  parseEnumValues() {
    this.expectPunct('{');
    const values = [];
    while (!this.skipPunct('}')) {
      const start = this.loc();
      const description = this.parseDescription();
      const name = this.expectName();
      const directives = this.parseDirectives();
      values.push({ kind: 'EnumValueDefinition', name, description, directives, loc: start });
    }
    return values;
  }
}

export function parse(source) {
  return new Parser(source).parseDocument();
}

export function parseValue(source) {
  const parser = new Parser(source);
  const value = parser.parseValueLiteral(false);
  if (parser.current.kind !== TokenKind.EOF) {
    throw parser.syntaxError(`Unexpected ${describe(parser.current)} after value.`);
  }
  return value;
}
