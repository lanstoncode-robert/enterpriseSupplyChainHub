import { parse } from './parser.js';
import { GraphQLError } from './errors.js';

/* ------------------------------------------------------------------ *
 * Type references                                                     *
 * ------------------------------------------------------------------ */

export const NON_NULL = 'NON_NULL';
export const LIST = 'LIST';
export const NAMED = 'NAMED';

export const namedRef = (name) => ({ kind: NAMED, name });
export const listOf = (ofType) => ({ kind: LIST, ofType });
export const nonNull = (ofType) => ({ kind: NON_NULL, ofType });
export const isNonNullType = (type) => type?.kind === NON_NULL;
export const isListType = (type) => type?.kind === LIST;
export const isNamedType = (type) => type?.kind === NAMED;

export function getNamedType(type) {
  let current = type;
  while (current && current.kind !== NAMED) current = current.ofType;
  return current;
}

export function typeToString(type) {
  if (!type) return '<unknown>';
  if (type.kind === NON_NULL) return `${typeToString(type.ofType)}!`;
  if (type.kind === LIST) return `[${typeToString(type.ofType)}]`;
  return type.name;
}

/* ------------------------------------------------------------------ *
 * Built-in scalars                                                    *
 * ------------------------------------------------------------------ */

function badInput(message) {
  return new GraphQLError(message, { extensions: { code: 'BAD_USER_INPUT' } });
}

function serializeString(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  throw new GraphQLError('String cannot represent value: ' + JSON.stringify(value));
}

export const builtInScalars = {
  String: {
    kind: 'SCALAR',
    name: 'String',
    description: 'UTF-8 character sequence.',
    serialize: serializeString,
    parseValue(value) {
      if (typeof value !== 'string') throw badInput('String must be a string.');
      return value;
    },
  },
  Int: {
    kind: 'SCALAR',
    name: 'Int',
    description: 'Signed 32-bit integer.',
    serialize(value) {
      if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647) {
        throw new GraphQLError('Int cannot represent value: ' + JSON.stringify(value));
      }
      return value;
    },
    parseValue(value) {
      if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647) {
        throw badInput('Int must be a signed 32-bit integer.');
      }
      return value;
    },
  },
  Float: {
    kind: 'SCALAR',
    name: 'Float',
    description: 'Signed double-precision finite number.',
    serialize(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new GraphQLError('Float cannot represent value: ' + JSON.stringify(value));
      }
      return value;
    },
    parseValue(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw badInput('Float must be a finite number.');
      return value;
    },
  },
  Boolean: {
    kind: 'SCALAR',
    name: 'Boolean',
    description: 'true or false.',
    serialize(value) {
      if (typeof value !== 'boolean') throw new GraphQLError('Boolean cannot represent value: ' + JSON.stringify(value));
      return value;
    },
    parseValue(value) {
      if (typeof value !== 'boolean') throw badInput('Boolean must be true or false.');
      return value;
    },
  },
  ID: {
    kind: 'SCALAR',
    name: 'ID',
    description: 'Opaque identifier.',
    serialize(value) {
      if (typeof value === 'string') return value;
      if (Number.isInteger(value)) return String(value);
      throw new GraphQLError('ID cannot represent value: ' + JSON.stringify(value));
    },
    parseValue(value) {
      if (typeof value === 'string' && value.length > 0) return value;
      if (Number.isInteger(value)) return String(value);
      throw badInput('ID must be a non-empty string or integer.');
    },
  },
  DateTime: {
    kind: 'SCALAR',
    name: 'DateTime',
    description: 'ISO-8601 timestamp, serialized as UTC.',
    serialize(value) {
      const date = value instanceof Date ? value : new Date(value);
      if (Number.isNaN(date.getTime())) throw new GraphQLError('DateTime cannot represent value: ' + JSON.stringify(value));
      return date.toISOString();
    },
    parseValue(value) {
      if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
        throw badInput('DateTime must be an ISO-8601 string.');
      }
      return new Date(value).toISOString();
    },
  },
};

/* ------------------------------------------------------------------ *
 * Built-in directives                                                 *
 * ------------------------------------------------------------------ */

const boolArg = (name, description) => ({
  name,
  description,
  type: nonNull(namedRef('Boolean')),
  defaultValue: undefined,
  defaultValueAST: null,
});

export const builtInDirectives = [
  {
    kind: 'DIRECTIVE',
    name: 'include',
    description: 'Directs the executor to include this field or fragment only when the `if` argument is true.',
    locations: new Set(['FIELD', 'FRAGMENT_SPREAD', 'INLINE_FRAGMENT']),
    args: new Map([['if', boolArg('if', 'Included when true.')]]),
    repeatable: false,
  },
  {
    kind: 'DIRECTIVE',
    name: 'skip',
    description: 'Directs the executor to skip this field or fragment when the `if` argument is true.',
    locations: new Set(['FIELD', 'FRAGMENT_SPREAD', 'INLINE_FRAGMENT']),
    args: new Map([['if', boolArg('if', 'Skipped when true.')]]),
    repeatable: false,
  },
  {
    kind: 'DIRECTIVE',
    name: 'deprecated',
    description: 'Marks an element of a GraphQL schema as no longer supported.',
    locations: new Set(['FIELD_DEFINITION', 'ENUM_VALUE']),
    args: new Map([['reason', {
      name: 'reason',
      type: namedRef('String'),
      defaultValue: 'No longer supported',
      defaultValueAST: null,
    }]]),
    repeatable: false,
  },
  {
    kind: 'DIRECTIVE',
    name: 'specifiedBy',
    description: 'Provides a specification URL for a custom scalar.',
    locations: new Set(['SCALAR']),
    args: new Map([['url', {
      name: 'url',
      type: nonNull(namedRef('String')),
      defaultValue: undefined,
      defaultValueAST: null,
    }]]),
    repeatable: false,
  },
  {
    kind: 'DIRECTIVE',
    name: 'key',
    description: 'Federation-lite entity key used by the schema stitcher.',
    locations: new Set(['OBJECT', 'INTERFACE']),
    args: new Map([['fields', {
      name: 'fields',
      type: nonNull(namedRef('String')),
      defaultValue: undefined,
      defaultValueAST: null,
    }]]),
    repeatable: true,
  },
];

/* ------------------------------------------------------------------ *
 * Schema construction                                                 *
 * ------------------------------------------------------------------ */

const NAME_RE = /^[_A-Za-z][_0-9A-Za-z]*$/;

function definitionKey(kind) {
  switch (kind) {
    case 'ObjectTypeDefinition':
    case 'ObjectTypeExtension':
      return 'OBJECT';
    case 'InputObjectTypeDefinition':
    case 'InputObjectTypeExtension':
      return 'INPUT_OBJECT';
    case 'EnumTypeDefinition':
    case 'EnumTypeExtension':
      return 'ENUM';
    case 'ScalarTypeDefinition':
    case 'ScalarTypeExtension':
      return 'SCALAR';
    case 'InterfaceTypeDefinition':
    case 'InterfaceTypeExtension':
      return 'INTERFACE';
    case 'UnionTypeDefinition':
      return 'UNION';
    default:
      return null;
  }
}

function unwrapASTType(node) {
  if (node.kind === 'NonNullType') return { kind: NON_NULL, ofType: unwrapASTType(node.type) };
  if (node.kind === 'ListType') return { kind: LIST, ofType: unwrapASTType(node.type) };
  return namedRef(node.name);
}

function literalToJS(node) {
  switch (node.kind) {
    case 'IntValue':
    case 'FloatValue':
      return Number(node.value);
    case 'StringValue':
      return node.value;
    case 'BooleanValue':
      return node.value;
    case 'NullValue':
      return null;
    case 'EnumValue':
      return node.value;
    case 'ListValue':
      return node.values.map(literalToJS);
    case 'ObjectValue':
      return Object.fromEntries(node.fields.map((field) => [field.name, literalToJS(field.value)]));
    case 'Variable':
      throw new GraphQLError('Variables are not allowed in schema default values.', { extensions: { code: 'GRAPHQL_VALIDATION_FAILED' } });
    default:
      throw new GraphQLError(`Unsupported default value node ${node.kind}.`);
  }
}

export class GraphQLSchema {
  constructor() {
    this.types = new Map();
    this.directives = new Map();
    this.queryType = null;
    this.mutationType = null;
    this.subscriptionType = null;
    this.stitch = null;
  }

  getType(name) {
    return this.types.get(name) ?? null;
  }

  getOperationType(operation) {
    if (operation === 'query') return this.queryType;
    if (operation === 'mutation') return this.mutationType;
    if (operation === 'subscription') return this.subscriptionType;
    return null;
  }

  getField(parentType, fieldName) {
    if (!parentType) return null;
    if (fieldName === '__typename') {
      return {
        kind: 'FIELD',
        name: '__typename',
        type: nonNull(namedRef('String')),
        args: new Map(),
        resolve: (source) => source?.__typename ?? parentType.name,
      };
    }
    return parentType.fields?.get(fieldName) ?? null;
  }
}

export class SchemaBuilder {
  constructor(options = {}) {
    this.options = options;
    this.typeDefs = new Map();
    this.directiveDefs = new Map();
    this.schemaDef = null;
    this.rootOperationTypes = new Map();
    this.warnings = [];
  }

  build(source, options = {}) {
    const document = typeof source === 'string' ? parse(source) : source;
    const mergeTypes = options.mergeTypes ?? this.options.mergeTypes ?? false;
    this.collect(document, mergeTypes);

    this.mergeTypes = mergeTypes;
    const schema = new GraphQLSchema();
    for (const [name, scalar] of Object.entries(builtInScalars)) schema.types.set(name, scalar);

    // Register named type shells before resolving field types so forward
    // references and circular object graphs work naturally.
    for (const [name, def] of this.typeDefs) {
      this.assertName(name, def.node);
      if (def.kind === 'INTERFACE') {
        throw new GraphQLError(`Interface type "${name}" is not supported by this runtime. Use concrete object types.`, {
          locations: def.node?.loc ? [{ line: def.node.loc.line, column: def.node.loc.column }] : undefined,
          extensions: { code: 'GRAPHQL_VALIDATION_FAILED' },
        });
      }
      if (def.kind === 'UNION') {
        throw new GraphQLError(`Union type "${name}" is not supported by this runtime. Use concrete object types.`, {
          extensions: { code: 'GRAPHQL_VALIDATION_FAILED' },
        });
      }
      if (def.kind === 'SCALAR') {
        if (!schema.types.has(name)) {
          schema.types.set(name, {
            kind: 'SCALAR',
            name,
            description: def.description,
            serialize: (value) => String(value),
            parseValue: (value) => value,
          });
        }
        continue;
      }
      if (def.kind === 'ENUM') {
        if (schema.types.has(name)) {
          throw new GraphQLError(`Type "${name}" is defined more than once.`);
        }
        const values = new Map();
        for (const value of def.values) {
          this.assertName(value.name, value);
          if (values.has(value.name)) {
            if (mergeTypes) continue;
            throw new GraphQLError(`Enum "${name}" defines "${value.name}" more than once.`);
          }
          values.set(value.name, { name: value.name, description: value.description ?? null, directives: value.directives ?? [] });
        }
        if (values.size === 0) throw new GraphQLError(`Enum "${name}" must define at least one value.`);
        schema.types.set(name, { kind: 'ENUM', name, description: def.description, values, directives: def.directives });
        continue;
      }
      if (def.kind === 'OBJECT' || def.kind === 'INPUT_OBJECT') {
        if (schema.types.has(name)) throw new GraphQLError(`Type "${name}" is defined more than once.`);
        schema.types.set(name, {
          kind: def.kind,
          name,
          description: def.description,
          fields: new Map(),
          directives: def.directives ?? [],
        });
      }
    }

    // Build fields now that every named type is registered.
    for (const [name, def] of this.typeDefs) {
      const type = schema.types.get(name);
      if (!type || (type.kind !== 'OBJECT' && type.kind !== 'INPUT_OBJECT')) continue;
      const seen = new Map();
      for (const fieldNode of def.fields) {
        if (seen.has(fieldNode.name)) {
          const previous = seen.get(fieldNode.name);
          const sameSignature = JSON.stringify(previous.type) === JSON.stringify(fieldNode.type)
            && (previous.kind === 'InputValueDefinition') === (fieldNode.kind === 'InputValueDefinition');
          if (!mergeTypes || !sameSignature) {
            throw new GraphQLError(
              `Field "${name}.${fieldNode.name}" is defined more than once${sameSignature ? '' : ' with conflicting signatures'}.`,
            );
          }
          // Identical field contributed by another subgraph; the first
          // definition owns it and the stitcher keeps the matching resolver.
          continue;
        }
        seen.set(fieldNode.name, fieldNode);
        this.assertName(fieldNode.name, fieldNode);
        if (fieldNode.name === '__typename') throw new GraphQLError(`"${name}" cannot define reserved field "__typename".`);
        const fieldType = unwrapASTType(fieldNode.type);
        this.assertTypeExists(fieldType, fieldNode);
        if (fieldNode.kind === 'InputValueDefinition') {
          this.assertInputType(fieldType, schema, fieldNode);
          const defaultValue = fieldNode.defaultValue
            ? this.coerceDefaultValue(fieldNode.defaultValue, fieldType, schema)
            : undefined;
          if (defaultValue === undefined && isNonNullType(fieldType)) {
            // Input object fields may be non-null without a default; arguments
            // are checked separately at execution time.
          }
          type.fields.set(fieldNode.name, {
            kind: 'INPUT_FIELD',
            name: fieldNode.name,
            description: fieldNode.description ?? null,
            type: fieldType,
            defaultValue,
            defaultValueAST: fieldNode.defaultValue,
            directives: fieldNode.directives ?? [],
          });
        } else {
          this.assertOutputType(fieldType, schema, fieldNode);
          const args = this.buildArguments(fieldNode.arguments ?? [], schema);
          type.fields.set(fieldNode.name, {
            kind: 'FIELD',
            name: fieldNode.name,
            description: fieldNode.description ?? null,
            type: fieldType,
            args,
            directives: fieldNode.directives ?? [],
            deprecationReason: this.directiveArg(fieldNode.directives, 'deprecated', 'reason') ?? null,
            resolve: null,
          });
        }
      }
      if (type.fields.size === 0) throw new GraphQLError(`Type "${name}" must define at least one field.`);
    }

    // Directives: built-ins first, then user definitions (duplicates rejected).
    for (const directive of builtInDirectives) schema.directives.set(directive.name, directive);
    for (const [name, node] of this.directiveDefs) {
      if (schema.directives.has(name)) {
        throw new GraphQLError(`Directive "@${name}" is already defined.`);
      }
      schema.directives.set(name, {
        kind: 'DIRECTIVE',
        name,
        description: node.description,
        locations: new Set(node.locations ?? []),
        args: this.buildArguments(node.args ?? [], schema),
        repeatable: Boolean(node.repeatable),
      });
    }

    // Root operation types.
    const schemaNode = this.schemaDef;
    if (schemaNode?.operationTypes?.length) {
      for (const { operation, type } of schemaNode.operationTypes) {
        const rootType = schema.getType(type.name);
        if (!rootType || rootType.kind !== 'OBJECT') {
          throw new GraphQLError(`Schema ${operation} root type "${type.name}" must be an object type.`);
        }
        this.rootOperationTypes.set(operation, rootType);
      }
    } else {
      const query = schema.getType('Query');
      if (query?.kind === 'OBJECT') this.rootOperationTypes.set('query', query);
      const mutation = schema.getType('Mutation');
      if (mutation?.kind === 'OBJECT') this.rootOperationTypes.set('mutation', mutation);
    }
    schema.queryType = this.rootOperationTypes.get('query') ?? null;
    schema.mutationType = this.rootOperationTypes.get('mutation') ?? null;
    schema.subscriptionType = this.rootOperationTypes.get('subscription') ?? null;
    if (!schema.queryType) {
      throw new GraphQLError('Schema must define a Query root type.');
    }
    if (schema.subscriptionType) {
      throw new GraphQLError('Subscriptions are not supported by this runtime. Use polling or server-sent events at the HTTP layer.');
    }
    this.assertInputCycles(schema);
    schema.warnings = this.warnings;
    return schema;
  }

  collect(document, mergeTypes) {
    for (const definition of document.definitions) {
      if (definition.kind === 'SchemaDefinition') {
        if (this.schemaDef && !mergeTypes) throw new GraphQLError('Schema definition appears more than once.');
        this.schemaDef = { ...definition, operationTypes: [...(this.schemaDef?.operationTypes ?? []), ...definition.operationTypes] };
        continue;
      }
      if (definition.kind === 'SchemaExtension') {
        this.schemaDef = {
          ...(this.schemaDef ?? { operationTypes: [], directives: [] }),
          operationTypes: [...(this.schemaDef?.operationTypes ?? []), ...definition.operationTypes],
        };
        continue;
      }
      if (definition.kind === 'DirectiveDefinition') {
        if (this.directiveDefs.has(definition.name)) throw new GraphQLError(`Directive "@${definition.name}" is defined more than once.`);
        this.directiveDefs.set(definition.name, definition);
        continue;
      }
      const kind = definitionKey(definition.kind);
      if (!kind) throw new GraphQLError(`Unsupported definition kind ${definition.kind}.`);
      const isExtension = definition.kind.endsWith('Extension');
      const existing = this.typeDefs.get(definition.name);
      if (isExtension) {
        if (!existing) throw new GraphQLError(`Cannot extend unknown type "${definition.name}".`);
        if (existing.kind !== kind) throw new GraphQLError(`Cannot extend ${existing.kind} "${definition.name}" as ${kind}.`);
        existing.fields.push(...(definition.fields ?? []));
        existing.values.push(...(definition.values ?? []));
        existing.directives = [...(existing.directives ?? []), ...(definition.directives ?? [])];
        continue;
      }
      if (existing) {
        if (!mergeTypes) throw new GraphQLError(`Type "${definition.name}" is defined more than once.`);
        if (existing.kind !== kind) throw new GraphQLError(`Type "${definition.name}" is defined as both ${existing.kind} and ${kind}.`);
        // Merge duplicate definitions from distinct subgraphs. Field-level
        // conflicts are checked after the merge when signatures are built.
        existing.fields.push(...(definition.fields ?? []));
        existing.values.push(...(definition.values ?? []));
        existing.directives = [...(existing.directives ?? []), ...(definition.directives ?? [])];
        existing.node = definition;
        continue;
      }
      this.typeDefs.set(definition.name, {
        kind,
        description: definition.description ?? null,
        directives: definition.directives ?? [],
        fields: [...(definition.fields ?? [])],
        values: [...(definition.values ?? [])],
        node: definition,
      });
    }
  }

  buildArguments(nodes, schema) {
    const args = new Map();
    for (const node of nodes) {
      if (args.has(node.name)) throw new GraphQLError(`Argument "${node.name}" is defined more than once.`);
      this.assertName(node.name, node);
      const type = unwrapASTType(node.type);
      this.assertTypeExists(type, node);
      this.assertInputType(type, schema, node);
      const defaultValue = node.defaultValue ? this.coerceDefaultValue(node.defaultValue, type, schema) : undefined;
      if (defaultValue === null && isNonNullType(type)) {
        throw new GraphQLError(`Argument "${node.name}" cannot default to null because its type is non-null.`);
      }
      args.set(node.name, {
        kind: 'ARGUMENT',
        name: node.name,
        description: node.description ?? null,
        type,
        defaultValue,
        defaultValueAST: node.defaultValue,
        directives: node.directives ?? [],
      });
    }
    return args;
  }

  assertName(name, node) {
    if (!NAME_RE.test(name)) throw new GraphQLError(`Invalid GraphQL name "${name}".`);
    if (name.startsWith('__')) throw new GraphQLError(`Name "${name}" is reserved for introspection.`);
    if (!node) return;
  }

  assertTypeExists(typeRef, node) {
    const named = getNamedType(typeRef);
    if (!named) return;
    const type = this.typeDefs.get(named.name) ?? (builtInScalars[named.name] ? { kind: 'SCALAR' } : null);
    if (!type) {
      const location = node?.loc ? { line: node.loc.line, column: node.loc.column } : undefined;
      throw new GraphQLError(`Unknown type "${named.name}".`, {
        locations: location ? [location] : undefined,
        extensions: { code: 'GRAPHQL_VALIDATION_FAILED' },
      });
    }
  }

  assertOutputType(typeRef, schema, node) {
    const named = getNamedType(typeRef);
    const type = schema.getType(named.name);
    if (!type) throw new GraphQLError(`Unknown output type "${named.name}".`);
    if (type.kind === 'INPUT_OBJECT') throw new GraphQLError(`Input type "${named.name}" cannot be used as an output type.`);
  }

  assertInputType(typeRef, schema, node) {
    const named = getNamedType(typeRef);
    const type = schema.getType(named.name);
    if (!type) throw new GraphQLError(`Unknown input type "${named.name}".`);
    if (type.kind === 'OBJECT') throw new GraphQLError(`Object type "${named.name}" cannot be used as an input type.`);
  }

  coerceDefaultValue(node, typeRef, schema) {
    if (typeRef.kind === NON_NULL) {
      if (node.kind === 'NullValue') throw new GraphQLError('Non-null value cannot be null.');
      return this.coerceDefaultValue(node, typeRef.ofType, schema);
    }
    if (node.kind === 'NullValue') return null;
    if (typeRef.kind === LIST) {
      if (node.kind === 'ListValue') return node.values.map((value) => this.coerceDefaultValue(value, typeRef.ofType, schema));
      return [this.coerceDefaultValue(node, typeRef.ofType, schema)];
    }
    const type = schema.getType(typeRef.name);
    if (!type) throw new GraphQLError(`Unknown type "${typeRef.name}" in default value.`);
    if (type.kind === 'SCALAR') {
      try {
        return type.parseValue(literalToJS(node));
      } catch (error) {
        throw new GraphQLError(`Invalid default value for ${type.name}: ${error.message}`);
      }
    }
    if (type.kind === 'ENUM') {
      if (node.kind !== 'EnumValue' || !type.values.has(node.value)) {
        throw new GraphQLError(`Invalid default value for enum ${type.name}.`);
      }
      return node.value;
    }
    if (type.kind === 'INPUT_OBJECT') {
      if (node.kind !== 'ObjectValue') throw new GraphQLError(`Default value for ${type.name} must be an object.`);
      const result = {};
      const provided = new Map(node.fields.map((field) => [field.name, field.value]));
      for (const [fieldName, value] of provided) {
        if (!type.fields.has(fieldName)) throw new GraphQLError(`Unknown field "${fieldName}" in default ${type.name}.`);
      }
      for (const [fieldName, fieldDef] of type.fields) {
        if (provided.has(fieldName)) {
          result[fieldName] = this.coerceDefaultValue(provided.get(fieldName), fieldDef.type, schema);
        } else if (fieldDef.defaultValue !== undefined) {
          result[fieldName] = fieldDef.defaultValue;
        } else if (isNonNullType(fieldDef.type)) {
          throw new GraphQLError(`Missing required field "${fieldName}" in default ${type.name}.`);
        }
      }
      return result;
    }
    throw new GraphQLError(`Unsupported default value type ${type.kind}.`);
  }

  assertInputCycles(schema) {
    const visited = new Set();
    const stack = new Set();
    const visit = (type) => {
      if (!type || type.kind !== 'INPUT_OBJECT') return;
      if (stack.has(type.name)) throw new GraphQLError(`Input object "${type.name}" contains an unbroken non-null cycle.`);
      if (visited.has(type.name)) return;
      stack.add(type.name);
      for (const field of type.fields.values()) {
        if (isNonNullType(field.type) && !isListType(field.type.ofType)) {
          const named = getNamedType(field.type);
          const target = schema.getType(named.name);
          if (target?.kind === 'INPUT_OBJECT') visit(target);
        }
      }
      stack.delete(type.name);
      visited.add(type.name);
    };
    for (const type of schema.types.values()) visit(type);
  }

  directiveArg(directives, name, argName) {
    const directive = (directives ?? []).find((item) => item.name === name);
    if (!directive) return undefined;
    const arg = directive.arguments?.find((item) => item.name === argName);
    return arg?.value?.value;
  }
}

export function buildSchema(source, options = {}) {
  return new SchemaBuilder(options).build(source, options);
}

/* ------------------------------------------------------------------ *
 * Printing / introspection JSON for the bundled explorer              *
 * ------------------------------------------------------------------ */

function printDescription(description, indent = '') {
  if (!description) return '';
  const escaped = description.replace(/"""/g, '\\"""');
  return `${indent}"""\n${indent}${escaped.split('\n').join(`\n${indent}`)}\n${indent}"""\n`;
}

function printDefaultValue(value, typeRef, schema) {
  if (value === undefined) return '';
  if (typeRef.kind === NON_NULL) return printDefaultValue(value, typeRef.ofType, schema);
  if (typeRef.kind === LIST) {
    const values = Array.isArray(value) ? value : [value];
    return `[${values.map((item) => printDefaultValue(item, typeRef.ofType, schema)).join(', ')}]`;
  }
  const type = schema.getType(typeRef.name);
  if (!type) return JSON.stringify(value);
  if (type.kind === 'ENUM') return String(value);
  if (type.kind === 'SCALAR') {
    if (type.name === 'String' || type.name === 'ID' || type.name === 'DateTime') return JSON.stringify(value);
    return String(value);
  }
  if (type.kind === 'INPUT_OBJECT' && value && typeof value === 'object') {
    const fields = Object.entries(value)
      .map(([key, item]) => `${key}: ${printDefaultValue(item, type.fields.get(key)?.type ?? namedRef('String'), schema)}`)
      .join(', ');
    return `{ ${fields} }`;
  }
  return JSON.stringify(value);
}

function printArgs(args, schema) {
  if (!args || args.size === 0) return '';
  const parts = [];
  for (const arg of args.values()) {
    let part = `${arg.name}: ${typeToString(arg.type)}`;
    if (arg.defaultValue !== undefined) part += ` = ${printDefaultValue(arg.defaultValue, arg.type, schema)}`;
    parts.push(part);
  }
  return `(${parts.join(', ')})`;
}

export function printSchema(schema) {
  const chunks = [];
  for (const type of schema.types.values()) {
    if (type.kind === 'SCALAR') {
      if (type.name === 'String' || type.name === 'Int' || type.name === 'Float' || type.name === 'Boolean' || type.name === 'ID') continue;
      chunks.push(`${printDescription(type.description)}scalar ${type.name}`);
      continue;
    }
    if (type.kind === 'ENUM') {
      const values = [...type.values.values()].map((value) => `  ${value.name}`).join('\n');
      chunks.push(`${printDescription(type.description)}enum ${type.name} {\n${values}\n}`);
      continue;
    }
    if (type.kind === 'OBJECT') {
      const fields = [...type.fields.values()].map((field) => {
        const deprecation = field.deprecationReason ? ` @deprecated(reason: ${JSON.stringify(field.deprecationReason)})` : '';
        return `  ${field.name}${printArgs(field.args, schema)}: ${typeToString(field.type)}${deprecation}`;
      }).join('\n');
      chunks.push(`${printDescription(type.description)}type ${type.name} {\n${fields}\n}`);
      continue;
    }
    if (type.kind === 'INPUT_OBJECT') {
      const fields = [...type.fields.values()].map((field) => {
        const defaultValue = field.defaultValue !== undefined
          ? ` = ${printDefaultValue(field.defaultValue, field.type, schema)}`
          : '';
        return `  ${field.name}: ${typeToString(field.type)}${defaultValue}`;
      }).join('\n');
      chunks.push(`${printDescription(type.description)}input ${type.name} {\n${fields}\n}`);
    }
  }
  return chunks.join('\n\n') + '\n';
}

export function schemaToJSON(schema) {
  const types = [];
  for (const type of schema.types.values()) {
    if (type.kind === 'SCALAR') {
      types.push({ kind: 'SCALAR', name: type.name, description: type.description ?? null });
    } else if (type.kind === 'ENUM') {
      types.push({
        kind: 'ENUM',
        name: type.name,
        description: type.description ?? null,
        enumValues: [...type.values.keys()],
      });
    } else if (type.kind === 'OBJECT') {
      types.push({
        kind: 'OBJECT',
        name: type.name,
        description: type.description ?? null,
        fields: [...type.fields.values()].map((field) => ({
          name: field.name,
          description: field.description ?? null,
          type: typeToString(field.type),
          args: [...field.args.values()].map((arg) => ({
            name: arg.name,
            type: typeToString(arg.type),
            defaultValue: arg.defaultValue ?? null,
          })),
        })),
      });
    } else if (type.kind === 'INPUT_OBJECT') {
      types.push({
        kind: 'INPUT_OBJECT',
        name: type.name,
        description: type.description ?? null,
        inputFields: [...type.fields.values()].map((field) => ({
          name: field.name,
          type: typeToString(field.type),
          defaultValue: field.defaultValue ?? null,
        })),
      });
    }
  }
  return {
    queryType: schema.queryType?.name ?? null,
    mutationType: schema.mutationType?.name ?? null,
    types,
    directives: [...schema.directives.values()].map((directive) => ({
      name: directive.name,
      description: directive.description ?? null,
      locations: [...directive.locations],
      repeatable: Boolean(directive.repeatable),
      args: [...directive.args.values()].map((arg) => ({ name: arg.name, type: typeToString(arg.type) })),
    })),
    stitch: schema.stitch,
  };
}
