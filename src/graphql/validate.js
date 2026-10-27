import { GraphQLValidationError } from './errors.js';
import { getNamedType, isNonNullType, isListType, NON_NULL, LIST } from './schema.js';

const MAX_SUGGESTIONS = 5;

/* ------------------------------------------------------------------ *
 * Small utilities                                                     *
 * ------------------------------------------------------------------ */

export function suggestionList(input, options) {
  const threshold = Math.max(1, Math.floor(input.length * 0.4));
  return [...options]
    .map((option) => ({ option, distance: levenshtein(input.toLowerCase(), option.toLowerCase()) }))
    .filter(({ distance }) => distance <= threshold)
    .sort((a, b) => a.distance - b.distance || a.option.localeCompare(b.option))
    .slice(0, MAX_SUGGESTIONS)
    .map(({ option }) => option);
}

function levenshtein(a, b) {
  if (a === b) return 0;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix = Array.from({ length: rows }, (_, i) => [i, ...Array(cols - 1).fill(0)]);
  for (let j = 1; j < cols; j += 1) matrix[0][j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
    }
  }
  return matrix[rows - 1][cols - 1];
}

function astTypeToString(node) {
  if (!node) return '<unknown>';
  if (node.kind === 'NonNullType') return `${astTypeToString(node.type)}!`;
  if (node.kind === 'ListType') return `[${astTypeToString(node.type)}]`;
  return node.name;
}

function astTypeToRef(node) {
  if (node.kind === 'NonNullType') return { kind: NON_NULL, ofType: astTypeToRef(node.type) };
  if (node.kind === 'ListType') return { kind: LIST, ofType: astTypeToRef(node.type) };
  return { kind: 'NAMED', name: node.name };
}

function hasNonNullDefault(node) {
  return Boolean(node && node.kind !== 'NullValue');
}

function variablesAllowed(variableType, locationType, variableHasDefault, locationHasDefault) {
  if (variableType.kind === NON_NULL) {
    return variablesAllowed(variableType.ofType, locationType, true, locationHasDefault);
  }
  if (locationType.kind === NON_NULL) {
    if (!variableHasDefault && !locationHasDefault) return false;
    return variablesAllowed(variableType, locationType.ofType, variableHasDefault, true);
  }
  if (variableType.kind === LIST && locationType.kind === LIST) {
    return variablesAllowed(variableType.ofType, locationType.ofType, false, false);
  }
  if (variableType.kind === LIST || locationType.kind === LIST) return false;
  return variableType.name === locationType.name;
}

function locationOf(node) {
  return node?.loc ? [{ line: node.loc.line, column: node.loc.column }] : undefined;
}

class ValidationContext {
  constructor(schema, document) {
    this.schema = schema;
    this.document = document;
    this.errors = [];
    this.fragments = new Map();
    this.operations = [];
    this.usedFragments = new Set();
    this.reportedUndefinedVariables = new Set();
  }

  error(message, node) {
    this.errors.push(new GraphQLValidationError(message, node));
  }

  namedType(name) {
    return this.schema.getType(name);
  }
}

/* ------------------------------------------------------------------ *
 * Public entry point                                                  *
 * ------------------------------------------------------------------ */

export function validate(schema, document) {
  const context = new ValidationContext(schema, document);

  for (const definition of document.definitions) {
    if (definition.kind === 'OperationDefinition') {
      context.operations.push(definition);
    } else if (definition.kind === 'FragmentDefinition') {
      if (context.fragments.has(definition.name)) {
        context.error(`There can be only one fragment named "${definition.name}".`, definition);
      } else {
        context.fragments.set(definition.name, definition);
      }
    } else {
      context.error('Executable documents may only contain operations and fragments. SDL is served at /graphql/schema.graphql.', definition);
    }
  }

  if (context.operations.length === 0 && context.fragments.size === 0) {
    context.error('The document does not contain any operations.', document);
    return context.errors;
  }

  const names = new Set();
  let anonymousCount = 0;
  for (const operation of context.operations) {
    if (!operation.name) {
      anonymousCount += 1;
      if (context.operations.length > 1) {
        context.error('This anonymous operation must be the only defined operation.', operation);
      }
    } else if (names.has(operation.name)) {
      context.error(`There can be only one operation named "${operation.name}".`, operation);
    } else {
      names.add(operation.name);
    }
    if (operation.operation === 'subscription') {
      context.error('Subscriptions are not supported by this gateway. Use queries and mutations.', operation);
      continue;
    }
    if (!schema.getOperationType(operation.operation)) {
      context.error(`Schema is not configured for ${operation.operation} operations.`, operation);
      continue;
    }
    validateOperation(context, operation);
  }

  for (const fragment of context.fragments.values()) {
    validateFragmentDefinition(context, fragment);
    if (!context.usedFragments.has(fragment.name)) {
      context.error(`Fragment "${fragment.name}" is never used.`, fragment);
    }
  }

  detectFragmentCycles(context);
  return context.errors;
}

/* ------------------------------------------------------------------ *
 * Operations and fragments                                            *
 * ------------------------------------------------------------------ */

function validateOperation(context, operation) {
  const rootType = context.schema.getOperationType(operation.operation);
  const variableDefs = new Map();
  const usages = new Map();
  const state = Object.assign(Object.create(context), {
    rootType,
    variableDefs,
    usages,
    validateVariables: true,
    reportedUndefinedVariables: new Set(),
  });

  for (const definition of operation.variableDefinitions ?? []) {
    if (variableDefs.has(definition.name)) {
      context.error(`There can be only one variable named "$${definition.name}".`, definition);
      continue;
    }
    const named = getNamedType(astTypeToRef(definition.type));
    const type = context.namedType(named.name);
    if (!type) {
      context.error(`Unknown type "${named.name}" for variable "$${definition.name}".`, definition);
      continue;
    }
    if (type.kind === 'OBJECT') {
      context.error(`Variable "$${definition.name}" cannot be non-input type "${astTypeToString(definition.type)}".`, definition);
      continue;
    }
    variableDefs.set(definition.name, {
      name: definition.name,
      type: astTypeToRef(definition.type),
      typeNode: definition.type,
      defaultValue: definition.defaultValue,
      node: definition,
    });
    if (definition.defaultValue) {
      validateValueNode(state, definition.defaultValue, astTypeToRef(definition.type), {
        locationDefault: true,
        variableName: `$${definition.name}`,
      });
    }
  }

  validateDirectives(state, operation.directives, operation.operation.toUpperCase(), operation);
  validateSelectionSet(state, rootType, operation.selectionSet, new Set());

  for (const definition of variableDefs.values()) {
    if (!usages.has(definition.name)) {
      context.error(`Variable "$${definition.name}" is never used in operation${operation.name ? ` "${operation.name}"` : ''}.`, definition.node);
    }
  }
}

function validateFragmentDefinition(context, fragment) {
  const type = context.namedType(fragment.typeCondition.name);
  if (!type) {
    context.error(`Unknown type "${fragment.typeCondition.name}" in fragment "${fragment.name}".`, fragment);
    return;
  }
  if (type.kind !== 'OBJECT') {
    context.error(`Fragment "${fragment.name}" cannot condition on non-object type "${type.name}".`, fragment);
    return;
  }
  const state = Object.assign(Object.create(context), {
    variableDefs: new Map(),
    usages: new Map(),
    validateVariables: false,
    reportedUndefinedVariables: new Set(),
  });
  validateDirectives(state, fragment.directives, 'FRAGMENT_DEFINITION', fragment);
  validateSelectionSet(state, type, fragment.selectionSet, new Set());
}

function detectFragmentCycles(context) {
  const visiting = new Set();
  const visited = new Set();

  const walk = (name, stack) => {
    const fragment = context.fragments.get(name);
    if (!fragment || visited.has(name)) return;
    if (visiting.has(name)) {
      const cycle = [...stack.slice(stack.indexOf(name)), name].join(' -> ');
      context.error(`Cannot spread fragment "${name}" within itself (${cycle}).`, fragment);
      return;
    }
    visiting.add(name);
    for (const spread of collectSpreads(fragment.selectionSet)) {
      walk(spread.name, [...stack, name]);
    }
    visiting.delete(name);
    visited.add(name);
  };

  for (const name of context.fragments.keys()) walk(name, []);
}

function collectSpreads(selectionSet) {
  const spreads = [];
  const walk = (set) => {
    for (const selection of set.selections) {
      if (selection.kind === 'FragmentSpread') spreads.push(selection);
      else if (selection.selectionSet) walk(selection.selectionSet);
    }
  };
  walk(selectionSet);
  return spreads;
}

/* ------------------------------------------------------------------ *
 * Selection sets                                                      *
 * ------------------------------------------------------------------ */

function validateSelectionSet(state, parentType, selectionSet, visitingFragments) {
  for (const selection of selectionSet.selections) {
    if (selection.kind === 'Field') {
      validateField(state, parentType, selection, visitingFragments);
    } else if (selection.kind === 'FragmentSpread') {
      validateFragmentSpread(state, parentType, selection, visitingFragments);
    } else if (selection.kind === 'InlineFragment') {
      validateInlineFragment(state, parentType, selection, visitingFragments);
    }
  }
}

function validateField(state, parentType, fieldNode, visitingFragments) {
  if (fieldNode.name === '__typename') {
    if (fieldNode.arguments.length > 0) state.error('"__typename" does not accept arguments.', fieldNode);
    if (fieldNode.selectionSet) state.error('"__typename" must not have a selection set.', fieldNode);
    return;
  }
  if (fieldNode.name === '__schema' || fieldNode.name === '__type') {
    state.error('Introspection is disabled on this gateway. Fetch /graphql/schema.json or /graphql/schema.graphql instead.', fieldNode);
    return;
  }

  const fieldDef = parentType.fields?.get(fieldNode.name);
  if (!fieldDef) {
    const suggestions = suggestionList(fieldNode.name, parentType.fields?.keys() ?? []);
    state.error(
      `Cannot query field "${fieldNode.name}" on type "${parentType.name}".${suggestions.length ? ` Did you mean ${suggestions.map((s) => `"${s}"`).join(' or ')}?` : ''}`,
      fieldNode,
    );
    return;
  }

  validateArguments(state, fieldNode, fieldDef.args, fieldDef);

  const named = getNamedType(fieldDef.type);
  const namedType = state.namedType(named.name);
  if (namedType?.kind === 'OBJECT') {
    if (!fieldNode.selectionSet) {
      state.error(`Field "${fieldNode.name}" of type "${namedType.name}" must have a selection of subfields.`, fieldNode);
    } else {
      validateSelectionSet(state, namedType, fieldNode.selectionSet, visitingFragments);
    }
  } else if (fieldNode.selectionSet) {
    state.error(`Field "${fieldNode.name}" must not have a selection since type "${named.name}" has no subfields.`, fieldNode);
  }

  validateDirectives(state, fieldNode.directives, 'FIELD', fieldNode);
}

function validateArguments(state, node, argDefs, owner) {
  const provided = new Map();
  for (const argNode of node.arguments) {
    if (provided.has(argNode.name)) {
      state.error(`There can be only one argument named "${argNode.name}".`, argNode);
      continue;
    }
    provided.set(argNode.name, argNode);
    const argDef = argDefs?.get(argNode.name);
    if (!argDef) {
      const suggestions = suggestionList(argNode.name, argDefs?.keys() ?? []);
      state.error(
        `Unknown argument "${argNode.name}" on ${owner.kind === 'DIRECTIVE' ? `directive "@${owner.name}"` : `field "${owner.name}"`}.${suggestions.length ? ` Did you mean ${suggestions.map((s) => `"${s}"`).join(' or ')}?` : ''}`,
        argNode,
      );
      continue;
    }
    validateValueNode(state, argNode.value, argDef.type, {
      locationDefault: argDef.defaultValue !== undefined,
      argumentName: argNode.name,
    });
  }
  for (const [name, argDef] of argDefs ?? []) {
    if (isNonNullType(argDef.type) && argDef.defaultValue === undefined && !provided.has(name)) {
      state.error(`Field "${owner.name}" is missing required argument "${name}" of type "${astTypeToString(typeRefToAST(argDef.type))}".`, node);
    }
  }
}

function validateValueNode(state, node, typeRef, options = {}) {
  if (node.kind === 'Variable') {
    if (!state.validateVariables) return;
    const variable = state.variableDefs.get(node.name);
    if (!variable) {
      if (!state.reportedUndefinedVariables.has(node.name)) {
        state.reportedUndefinedVariables.add(node.name);
        state.error(`Variable "$${node.name}" is not defined${options.argumentName ? ` by argument "${options.argumentName}"` : ''}.`, node);
      }
      return;
    }
    state.usages.set(node.name, node);
    if (!variablesAllowed(variable.type, typeRef, hasNonNullDefault(variable.defaultValue), Boolean(options.locationDefault))) {
      state.error(
        `Variable "$${node.name}" of type "${astTypeToString(variable.typeNode)}" used in position expecting type "${astTypeToString(typeRefToAST(typeRef))}".`,
        node,
      );
    }
    return;
  }
  if (typeRef.kind === NON_NULL) {
    if (node.kind === 'NullValue') {
      state.error('Expected a non-null value, found null.', node);
      return;
    }
    validateValueNode(state, node, typeRef.ofType, options);
    return;
  }
  if (node.kind === 'NullValue') return;
  if (typeRef.kind === LIST) {
    if (node.kind === 'ListValue') {
      for (const value of node.values) validateValueNode(state, value, typeRef.ofType, {});
    } else {
      validateValueNode(state, node, typeRef.ofType, options);
    }
    return;
  }

  const named = state.namedType(typeRef.name);
  if (!named) {
    state.error(`Unknown type "${typeRef.name}".`, node);
    return;
  }

  if (named.kind === 'SCALAR') {
    validateScalarLiteral(state, node, named);
    return;
  }

  if (named.kind === 'ENUM') {
    if (node.kind !== 'EnumValue') {
      state.error(`Enum "${named.name}" cannot represent a non-enum literal.`, node);
      return;
    }
    if (!named.values.has(node.value)) {
      const suggestions = suggestionList(node.value, named.values.keys());
      state.error(
        `Value "${node.value}" does not exist in enum "${named.name}".${suggestions.length ? ` Did you mean ${suggestions.map((s) => `"${s}"`).join(' or ')}?` : ''}`,
        node,
      );
    }
    return;
  }

  if (named.kind === 'INPUT_OBJECT') {
    if (node.kind !== 'ObjectValue') {
      state.error(`Expected an object value for input type "${named.name}".`, node);
      return;
    }
    const fields = new Map();
    for (const field of node.fields) {
      if (fields.has(field.name)) {
        state.error(`There can be only one input field named "${field.name}".`, field);
        continue;
      }
      fields.set(field.name, field);
      const fieldDef = named.fields.get(field.name);
      if (!fieldDef) {
        const suggestions = suggestionList(field.name, named.fields.keys());
        state.error(
          `Field "${field.name}" is not defined by input type "${named.name}".${suggestions.length ? ` Did you mean ${suggestions.map((s) => `"${s}"`).join(' or ')}?` : ''}`,
          field,
        );
        continue;
      }
      validateValueNode(state, field.value, fieldDef.type, {
        locationDefault: fieldDef.defaultValue !== undefined,
        argumentName: field.name,
      });
    }
    for (const [fieldName, fieldDef] of named.fields) {
      if (isNonNullType(fieldDef.type) && fieldDef.defaultValue === undefined && !fields.has(fieldName)) {
        state.error(`Input field "${named.name}.${fieldName}" of required type "${astTypeToString(typeRefToAST(fieldDef.type))}" was not provided.`, node);
      }
    }
  }
}

function validateScalarLiteral(state, node, scalar) {
  const allowed = {
    String: ['StringValue'],
    ID: ['StringValue', 'IntValue'],
    Int: ['IntValue'],
    Float: ['IntValue', 'FloatValue'],
    Boolean: ['BooleanValue'],
    DateTime: ['StringValue'],
  }[scalar.name];
  if (allowed && !allowed.includes(node.kind)) {
    state.error(`Expected type "${scalar.name}", found ${node.kind.replace('Value', '').toLowerCase()} literal.`, node);
    return;
  }
  if (scalar.name === 'DateTime' && node.kind === 'StringValue' && Number.isNaN(Date.parse(node.value))) {
    state.error('DateTime literal must be a valid ISO-8601 string.', node);
  }
}

function validateDirectives(state, directives, location, owner) {
  if (!directives?.length) return;
  const seen = new Map();
  for (const directiveNode of directives) {
    const directive = state.schema.directives.get(directiveNode.name);
    if (!directive) {
      state.error(`Unknown directive "@${directiveNode.name}".`, directiveNode);
      continue;
    }
    if (!directive.locations.has(location)) {
      state.error(`Directive "@${directive.name}" may not be used on ${location}.`, directiveNode);
    }
    if (!directive.repeatable) {
      if (seen.has(directive.name)) state.error(`Directive "@${directive.name}" can only be used once at this location.`, directiveNode);
      seen.set(directive.name, directiveNode);
    }
    validateArguments(state, directiveNode, directive.args, { ...directive, kind: 'DIRECTIVE' });
  }
}

function validateFragmentSpread(state, parentType, spread, visitingFragments) {
  validateDirectives(state, spread.directives, 'FRAGMENT_SPREAD', spread);
  if (visitingFragments.has(spread.name)) return;
  if (state.usedFragments) state.usedFragments.add(spread.name);
  const fragment = state.fragments.get(spread.name);
  if (!fragment) {
    const suggestions = suggestionList(spread.name, state.fragments.keys());
    state.error(
      `Unknown fragment "${spread.name}".${suggestions.length ? ` Did you mean ${suggestions.map((s) => `"${s}"`).join(' or ')}?` : ''}`,
      spread,
    );
    return;
  }
  const fragmentType = state.namedType(fragment.typeCondition.name);
  if (!fragmentType) {
    state.error(`Unknown type "${fragment.typeCondition.name}" in fragment "${fragment.name}".`, fragment);
    return;
  }
  if (fragmentType.name !== parentType.name) {
    state.error(`Fragment "${spread.name}" cannot be spread here because type "${fragmentType.name}" can never be "${parentType.name}".`, spread);
    return;
  }
  const nextVisiting = new Set(visitingFragments).add(spread.name);
  validateSelectionSet(state, fragmentType, fragment.selectionSet, nextVisiting);
}

function validateInlineFragment(state, parentType, fragment, visitingFragments) {
  validateDirectives(state, fragment.directives, 'INLINE_FRAGMENT', fragment);
  let type = parentType;
  if (fragment.typeCondition) {
    const condition = state.namedType(fragment.typeCondition.name);
    if (!condition) {
      state.error(`Unknown type "${fragment.typeCondition.name}" in inline fragment.`, fragment);
      return;
    }
    if (condition.name !== parentType.name) {
      state.error(`Inline fragment cannot be spread here because type "${condition.name}" can never be "${parentType.name}".`, fragment);
      return;
    }
    type = condition;
  }
  validateSelectionSet(state, type, fragment.selectionSet, visitingFragments);
}

function typeRefToAST(typeRef) {
  if (typeRef.kind === NON_NULL) return { kind: 'NonNullType', type: typeRefToAST(typeRef.ofType) };
  if (typeRef.kind === LIST) return { kind: 'ListType', type: typeRefToAST(typeRef.ofType) };
  return { kind: 'NamedType', name: typeRef.name };
}
