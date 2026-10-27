import { GraphQLError, formatError, locatedError } from './errors.js';
import {
  getNamedType,
  isListType,
  isNonNullType,
  LIST,
  NON_NULL,
  typeToString,
} from './schema.js';

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

/* ------------------------------------------------------------------ *
 * Entry point                                                         *
 * ------------------------------------------------------------------ */

export async function execute({
  schema,
  document,
  operationName = null,
  variableValues = {},
  contextValue = {},
  rootValue = {},
  maskInternalErrors = true,
}) {
  const operation = getOperation(document, operationName);
  if (!operation) {
    return {
      errors: [formatError(new GraphQLError(
        operationName ? `Unknown operation named "${operationName}".` : 'Must provide an operation.',
        { extensions: { code: 'GRAPHQL_VALIDATION_FAILED' } },
      ))],
    };
  }

  const fragments = new Map();
  for (const definition of document.definitions) {
    if (definition.kind === 'FragmentDefinition') fragments.set(definition.name, definition);
  }

  const variableResult = coerceVariableValues(schema, operation, variableValues ?? {});
  if (variableResult.errors.length > 0) {
    return { errors: variableResult.errors.map(formatError) };
  }

  const rootType = schema.getOperationType(operation.operation);
  if (!rootType) {
    return {
      errors: [formatError(new GraphQLError(`Schema is not configured for ${operation.operation} operations.`, {
        extensions: { code: 'GRAPHQL_VALIDATION_FAILED' },
      }))],
    };
  }

  const ctx = {
    schema,
    fragments,
    variables: variableResult.coerced,
    contextValue,
    errors: [],
    operation,
    rootValue,
    maskInternalErrors,
  };

  try {
    const data = await executeFields(
      ctx,
      rootType,
      rootValue ?? {},
      operation.selectionSet,
      [],
      operation.operation === 'mutation',
    );
    return ctx.errors.length > 0 ? { data, errors: ctx.errors.map(formatError) } : { data };
  } catch (error) {
    const gqlError = toGraphQLError(error, ctx, operation);
    ctx.errors.push(gqlError);
    return { data: null, errors: ctx.errors.map(formatError) };
  }
}

export function getOperation(document, operationName) {
  const operations = document.definitions.filter((definition) => definition.kind === 'OperationDefinition');
  if (operationName) return operations.find((operation) => operation.name === operationName) ?? null;
  if (operations.length === 1) return operations[0];
  return operations.find((operation) => !operation.name) ?? null;
}

/* ------------------------------------------------------------------ *
 * Variables and input coercion                                        *
 * ------------------------------------------------------------------ */

export function coerceVariableValues(schema, operation, inputs) {
  const coerced = {};
  const errors = [];
  for (const definition of operation.variableDefinitions ?? []) {
    const type = astTypeToRef(definition.type);
    if (!isInputType(type, schema)) {
      errors.push(new GraphQLError(`Variable "$${definition.name}" cannot be non-input type "${typeToString(type)}".`, {
        extensions: { code: 'BAD_USER_INPUT' },
      }));
      continue;
    }
    if (!hasOwn(inputs, definition.name)) {
      if (definition.defaultValue) {
        try {
          coerced[definition.name] = valueFromAST(definition.defaultValue, type, schema, {});
        } catch (error) {
          errors.push(new GraphQLError(`Invalid default value for variable "$${definition.name}": ${error.message}`, {
            extensions: { code: 'BAD_USER_INPUT' },
          }));
        }
      } else if (isNonNullType(type)) {
        errors.push(new GraphQLError(`Variable "$${definition.name}" of required type "${typeToString(type)}" was not provided.`, {
          extensions: { code: 'BAD_USER_INPUT' },
        }));
      }
      continue;
    }
    const value = inputs[definition.name];
    if (value === null && isNonNullType(type)) {
      errors.push(new GraphQLError(`Variable "$${definition.name}" of non-null type "${typeToString(type)}" must not be null.`, {
        extensions: { code: 'BAD_USER_INPUT' },
      }));
      continue;
    }
    try {
      coerced[definition.name] = coerceInputValue(value, type, schema, ['variable', definition.name]);
    } catch (error) {
      errors.push(error instanceof GraphQLError ? error : new GraphQLError(String(error.message), {
        extensions: { code: 'BAD_USER_INPUT' },
      }));
    }
  }
  return { coerced, errors };
}

export function coerceInputValue(value, type, schema, path = []) {
  if (type.kind === NON_NULL) {
    if (value === null || value === undefined) {
      throw new GraphQLError(`Expected non-nullable value at "${path.join('.')}".`, {
        path,
        extensions: { code: 'BAD_USER_INPUT' },
      });
    }
    return coerceInputValue(value, type.ofType, schema, path);
  }
  if (value === null || value === undefined) return null;
  if (type.kind === LIST) {
    if (Array.isArray(value)) return value.map((item, index) => coerceInputValue(item, type.ofType, schema, [...path, index]));
    return [coerceInputValue(value, type.ofType, schema, path)];
  }
  const named = schema.getType(type.name);
  if (!named) {
    throw new GraphQLError(`Unknown input type "${type.name}".`, { path, extensions: { code: 'BAD_USER_INPUT' } });
  }
  if (named.kind === 'SCALAR') {
    try {
      return named.parseValue(value);
    } catch (error) {
      throw new GraphQLError(`Invalid value for "${path.join('.')}": ${error.message}`, {
        path,
        extensions: { code: 'BAD_USER_INPUT' },
      });
    }
  }
  if (named.kind === 'ENUM') {
    if (typeof value !== 'string' || !named.values.has(value)) {
      throw new GraphQLError(
        `Value ${JSON.stringify(value)} does not exist in enum "${named.name}"${path.length ? ` at "${path.join('.')}"` : ''}.`,
        { path, extensions: { code: 'BAD_USER_INPUT' } },
      );
    }
    return value;
  }
  if (named.kind === 'INPUT_OBJECT') {
    if (typeof value !== 'object' || Array.isArray(value)) {
      throw new GraphQLError(`Expected an object for input type "${named.name}" at "${path.join('.')}".`, {
        path,
        extensions: { code: 'BAD_USER_INPUT' },
      });
    }
    const result = {};
    for (const key of Object.keys(value)) {
      if (!named.fields.has(key)) {
        throw new GraphQLError(`Field "${key}" is not defined by input type "${named.name}".`, {
          path: [...path, key],
          extensions: { code: 'BAD_USER_INPUT' },
        });
      }
    }
    for (const [fieldName, fieldDef] of named.fields) {
      if (hasOwn(value, fieldName) && value[fieldName] !== undefined) {
        result[fieldName] = coerceInputValue(value[fieldName], fieldDef.type, schema, [...path, fieldName]);
      } else if (fieldDef.defaultValue !== undefined) {
        result[fieldName] = fieldDef.defaultValue;
      } else if (isNonNullType(fieldDef.type)) {
        throw new GraphQLError(`Field "${fieldName}" of required type "${typeToString(fieldDef.type)}" was not provided at "${path.join('.')}".`, {
          path: [...path, fieldName],
          extensions: { code: 'BAD_USER_INPUT' },
        });
      }
    }
    return result;
  }
  throw new GraphQLError(`Type "${named.name}" cannot be used as an input type.`, {
    path,
    extensions: { code: 'BAD_USER_INPUT' },
  });
}

export function valueFromAST(node, type, schema, variables) {
  if (node.kind === 'Variable') {
    const value = variables[node.name];
    if (value === undefined) return undefined;
    if (value === null && isNonNullType(type)) {
      throw new GraphQLError(`Variable "$${node.name}" must not be null for type "${typeToString(type)}".`, {
        extensions: { code: 'BAD_USER_INPUT' },
      });
    }
    return value;
  }
  if (type.kind === NON_NULL) {
    if (node.kind === 'NullValue') {
      throw new GraphQLError(`Expected non-null value of type "${typeToString(type)}", found null.`, {
        extensions: { code: 'BAD_USER_INPUT' },
      });
    }
    const value = valueFromAST(node, type.ofType, schema, variables);
    if (value === null || value === undefined) {
      throw new GraphQLError(`Expected non-null value of type "${typeToString(type)}".`, {
        extensions: { code: 'BAD_USER_INPUT' },
      });
    }
    return value;
  }
  if (node.kind === 'NullValue') return null;
  if (type.kind === LIST) {
    if (node.kind === 'ListValue') {
      return node.values.map((item) => {
        const value = valueFromAST(item, type.ofType, schema, variables);
        if (value === undefined) throw new GraphQLError('A list item resolved to an undefined variable.', {
          extensions: { code: 'BAD_USER_INPUT' },
        });
        return value;
      });
    }
    return [valueFromAST(node, type.ofType, schema, variables)];
  }

  const named = schema.getType(type.name);
  if (!named) throw new GraphQLError(`Unknown type "${type.name}".`, { extensions: { code: 'BAD_USER_INPUT' } });

  if (named.kind === 'SCALAR') {
    let raw;
    switch (node.kind) {
      case 'IntValue':
      case 'FloatValue':
        raw = Number(node.value);
        break;
      case 'StringValue':
        raw = node.value;
        break;
      case 'BooleanValue':
        raw = node.value;
        break;
      case 'EnumValue':
        raw = node.value;
        break;
      case 'ListValue':
        raw = node.values.map((item) => valueFromAST(item, { kind: 'NAMED', name: 'String' }, schema, variables));
        break;
      case 'ObjectValue':
        raw = Object.fromEntries(node.fields.map((field) => [field.name, valueFromAST(field.value, { kind: 'NAMED', name: 'String' }, schema, variables)]));
        break;
      default:
        throw new GraphQLError(`Unsupported literal for scalar "${named.name}".`, { extensions: { code: 'BAD_USER_INPUT' } });
    }
    try {
      return named.parseValue(raw);
    } catch (error) {
      throw new GraphQLError(`Invalid value for "${named.name}": ${error.message}`, {
        extensions: { code: 'BAD_USER_INPUT' },
      });
    }
  }
  if (named.kind === 'ENUM') {
    if (node.kind !== 'EnumValue' || !named.values.has(node.value)) {
      throw new GraphQLError(`Invalid value for enum "${named.name}".`, { extensions: { code: 'BAD_USER_INPUT' } });
    }
    return node.value;
  }
  if (named.kind === 'INPUT_OBJECT') {
    if (node.kind !== 'ObjectValue') {
      throw new GraphQLError(`Expected an object value for input type "${named.name}".`, {
        extensions: { code: 'BAD_USER_INPUT' },
      });
    }
    const provided = new Map(node.fields.map((field) => [field.name, field]));
    const result = {};
    for (const [fieldName, fieldDef] of named.fields) {
      const fieldNode = provided.get(fieldName);
      if (!fieldNode) {
        if (fieldDef.defaultValue !== undefined) result[fieldName] = fieldDef.defaultValue;
        else if (isNonNullType(fieldDef.type)) {
          throw new GraphQLError(`Missing required field "${fieldName}" for input type "${named.name}".`, {
            extensions: { code: 'BAD_USER_INPUT' },
          });
        }
        continue;
      }
      const value = valueFromAST(fieldNode.value, fieldDef.type, schema, variables);
      if (value === undefined) {
        if (fieldDef.defaultValue !== undefined) result[fieldName] = fieldDef.defaultValue;
        else if (isNonNullType(fieldDef.type)) {
          throw new GraphQLError(`Field "${fieldName}" of required type "${typeToString(fieldDef.type)}" was not provided.`, {
            extensions: { code: 'BAD_USER_INPUT' },
          });
        }
        continue;
      }
      result[fieldName] = value;
    }
    return result;
  }
  throw new GraphQLError(`Type "${named.name}" cannot be used as an input type.`, {
    extensions: { code: 'BAD_USER_INPUT' },
  });
}

function astTypeToRef(node) {
  if (node.kind === 'NonNullType') return { kind: NON_NULL, ofType: astTypeToRef(node.type) };
  if (node.kind === 'ListType') return { kind: LIST, ofType: astTypeToRef(node.type) };
  return { kind: 'NAMED', name: node.name };
}

function isInputType(typeRef, schema) {
  const named = getNamedType(typeRef);
  const type = schema.getType(named.name);
  return Boolean(type && type.kind !== 'OBJECT');
}

/* ------------------------------------------------------------------ *
 * Field execution                                                     *
 * ------------------------------------------------------------------ */

const defaultFieldResolver = (source, args, context, info) => {
  if (source === null || source === undefined) return null;
  const value = source[info.fieldName];
  return typeof value === 'function' ? value.call(source, args, context, info) : value;
};

async function executeFields(ctx, parentType, source, selectionSet, path, serial) {
  const fields = collectFields(ctx, parentType, selectionSet);
  const result = {};
  const entries = [...fields.entries()];
  if (serial) {
    for (const [key, fieldNodes] of entries) {
      // eslint-disable-next-line no-await-in-loop
      await executeFieldInto(ctx, result, key, parentType, source, fieldNodes, path);
    }
    return result;
  }
  await Promise.all(entries.map(([key, fieldNodes]) => executeFieldInto(ctx, result, key, parentType, source, fieldNodes, path)));
  return result;
}

async function executeFieldInto(ctx, result, key, parentType, source, fieldNodes, parentPath) {
  const fieldNode = fieldNodes[0];
  const fieldName = fieldNode.name;
  let fieldDef;
  try {
    fieldDef = ctx.schema.getField(parentType, fieldName);
    if (!fieldDef) throw new GraphQLError(`Unknown field "${fieldName}" on type "${parentType.name}".`);
    const path = [...parentPath, key];
    const info = {
      fieldName,
      parentType,
      returnType: fieldDef.type,
      fieldNodes,
      path,
      schema: ctx.schema,
      operation: ctx.operation,
      variables: ctx.variables,
      fragments: ctx.fragments,
      context: ctx.contextValue,
    };
    let args;
    try {
      args = getArgumentValues(fieldDef, fieldNode, ctx);
    } catch (error) {
      throw locatedError(error, fieldNode, path);
    }
    const resolver = fieldDef.resolve ?? defaultFieldResolver;
    let value;
    try {
      value = await resolver(source, args, ctx.contextValue, info);
    } catch (error) {
      throw normalizeError(error, ctx, path, fieldNode);
    }
    result[key] = await completeValue(ctx, fieldDef.type, fieldNodes, info, value, path);
  } catch (error) {
    const gqlError = normalizeError(error, ctx, [...parentPath, key], fieldNode);
    if (fieldDef && isNonNullType(fieldDef.type)) throw gqlError;
    ctx.errors.push(gqlError);
    result[key] = null;
  }
}

async function completeValue(ctx, type, fieldNodes, info, value, path) {
  if (type.kind === NON_NULL) {
    const completed = await completeValue(ctx, type.ofType, fieldNodes, info, value, path);
    if (completed === null || completed === undefined) {
      throw new GraphQLError(
        `Cannot return null for non-nullable field ${info.parentType.name}.${info.fieldName}.`,
        {
          path,
          locations: fieldNodes[0]?.loc ? [{ line: fieldNodes[0].loc.line, column: fieldNodes[0].loc.column }] : undefined,
          extensions: { code: 'INTERNAL_SERVER_ERROR' },
        },
      );
    }
    return completed;
  }
  if (value === null || value === undefined) return null;

  if (type.kind === LIST) {
    if (!Array.isArray(value)) {
      throw new GraphQLError(`Expected a list for field "${info.parentType.name}.${info.fieldName}".`, {
        path,
        extensions: { code: 'INTERNAL_SERVER_ERROR' },
      });
    }
    const items = [];
    for (let index = 0; index < value.length; index += 1) {
      const itemPath = [...path, index];
      try {
        // eslint-disable-next-line no-await-in-loop
        items.push(await completeValue(ctx, type.ofType, fieldNodes, info, value[index], itemPath));
      } catch (error) {
        const gqlError = normalizeError(error, ctx, itemPath, fieldNodes[0]);
        if (isNonNullType(type.ofType)) throw gqlError;
        ctx.errors.push(gqlError);
        items.push(null);
      }
    }
    return items;
  }

  const named = ctx.schema.getType(type.name);
  if (!named) throw new GraphQLError(`Unknown return type "${type.name}".`, { path });

  if (named.kind === 'SCALAR') {
    try {
      return named.serialize(value);
    } catch (error) {
      throw normalizeError(error, ctx, path, fieldNodes[0], `Scalar "${named.name}" serialization failed.`);
    }
  }

  if (named.kind === 'ENUM') {
    if (typeof value !== 'string' || !named.values.has(value)) {
      throw new GraphQLError(`Enum "${named.name}" cannot represent value ${JSON.stringify(value)}.`, {
        path,
        extensions: { code: 'INTERNAL_SERVER_ERROR' },
      });
    }
    return value;
  }

  if (named.kind === 'OBJECT') {
    if (typeof value !== 'object') {
      throw new GraphQLError(`Expected an object for field "${info.parentType.name}.${info.fieldName}".`, {
        path,
        extensions: { code: 'INTERNAL_SERVER_ERROR' },
      });
    }
    const selectionSet = mergeSelectionSets(fieldNodes);
    return executeFields(ctx, named, value, selectionSet, path, false);
  }

  throw new GraphQLError(`Cannot complete value of type "${named.kind}".`, { path });
}

function mergeSelectionSets(fieldNodes) {
  const selections = [];
  for (const node of fieldNodes) {
    if (node.selectionSet) selections.push(...node.selectionSet.selections);
  }
  return { kind: 'SelectionSet', selections };
}

/* ------------------------------------------------------------------ *
 * Argument and directive values                                       *
 * ------------------------------------------------------------------ */

export function getArgumentValues(fieldDef, node, ctx) {
  const values = {};
  const provided = new Map((node.arguments ?? []).map((arg) => [arg.name, arg]));
  for (const [name, argDef] of fieldDef.args ?? []) {
    const argNode = provided.get(name);
    if (!argNode) {
      if (argDef.defaultValue !== undefined) values[name] = argDef.defaultValue;
      else if (isNonNullType(argDef.type)) {
        throw new GraphQLError(`Argument "${name}" of required type "${typeToString(argDef.type)}" was not provided.`, {
          locations: node.loc ? [{ line: node.loc.line, column: node.loc.column }] : undefined,
          extensions: { code: 'GRAPHQL_VALIDATION_FAILED' },
        });
      }
      continue;
    }
    const value = valueFromAST(argNode.value, argDef.type, ctx.schema, ctx.variables);
    if (value === undefined) {
      if (argDef.defaultValue !== undefined) values[name] = argDef.defaultValue;
      else if (isNonNullType(argDef.type)) {
        throw new GraphQLError(`Argument "${name}" of required type "${typeToString(argDef.type)}" was not provided.`, {
          extensions: { code: 'GRAPHQL_VALIDATION_FAILED' },
        });
      }
      continue;
    }
    values[name] = value;
  }
  return values;
}

function getDirectiveValues(ctx, directive, node) {
  const directiveNode = (node.directives ?? []).find((item) => item.name === directive.name);
  if (!directiveNode) return undefined;
  const values = {};
  const provided = new Map((directiveNode.arguments ?? []).map((arg) => [arg.name, arg]));
  for (const [name, argDef] of directive.args) {
    const argNode = provided.get(name);
    if (!argNode) {
      if (argDef.defaultValue !== undefined) values[name] = argDef.defaultValue;
      continue;
    }
    const value = valueFromAST(argNode.value, argDef.type, ctx.schema, ctx.variables);
    if (value !== undefined) values[name] = value;
  }
  return values;
}

function shouldIncludeNode(ctx, node) {
  const skip = ctx.schema.directives.get('skip');
  const include = ctx.schema.directives.get('include');
  const skipValues = skip ? getDirectiveValues(ctx, skip, node) : undefined;
  if (skipValues?.if === true) return false;
  const includeValues = include ? getDirectiveValues(ctx, include, node) : undefined;
  if (includeValues && includeValues.if === false) return false;
  return true;
}

/* ------------------------------------------------------------------ *
 * Field collection (fragments, aliases, @skip/@include)               *
 * ------------------------------------------------------------------ */

function collectFields(ctx, runtimeType, selectionSet, fields = new Map(), visitedFragments = new Set()) {
  for (const selection of selectionSet.selections) {
    if (!shouldIncludeNode(ctx, selection)) continue;
    if (selection.kind === 'Field') {
      const key = selection.alias ?? selection.name;
      const existing = fields.get(key);
      if (existing) existing.push(selection);
      else fields.set(key, [selection]);
      continue;
    }
    if (selection.kind === 'InlineFragment') {
      if (selection.typeCondition && selection.typeCondition.name !== runtimeType.name) continue;
      collectFields(ctx, runtimeType, selection.selectionSet, fields, visitedFragments);
      continue;
    }
    if (selection.kind === 'FragmentSpread') {
      if (visitedFragments.has(selection.name)) continue;
      visitedFragments.add(selection.name);
      const fragment = ctx.fragments.get(selection.name);
      if (!fragment) continue;
      if (fragment.typeCondition.name !== runtimeType.name) continue;
      collectFields(ctx, runtimeType, fragment.selectionSet, fields, visitedFragments);
    }
  }
  return fields;
}

/* ------------------------------------------------------------------ *
 * Error normalisation                                                 *
 * ------------------------------------------------------------------ */

function toGraphQLError(error, ctx, operation) {
  if (error instanceof GraphQLError) return error;
  ctx.contextValue?.logger?.error?.('graphql.unexpected_error', {
    message: error?.message,
    stack: error?.stack,
    operation: operation?.name ?? null,
  });
  return new GraphQLError(ctx.maskInternalErrors ? 'Internal server error' : String(error?.message ?? error), {
    originalError: error,
    extensions: { code: 'INTERNAL_SERVER_ERROR' },
  });
}

function normalizeError(error, ctx, path, node, fallbackMessage) {
  if (error instanceof GraphQLError) {
    if (!error.path) error.path = path;
    return error;
  }
  ctx.contextValue?.logger?.error?.('graphql.resolver_error', {
    message: error?.message,
    stack: error?.stack,
    path,
  });
  return new GraphQLError(ctx.maskInternalErrors ? (fallbackMessage ?? 'Internal server error') : String(error?.message ?? error), {
    locations: node?.loc ? [{ line: node.loc.line, column: node.loc.column }] : undefined,
    path,
    originalError: error,
    extensions: { code: 'INTERNAL_SERVER_ERROR' },
  });
}
