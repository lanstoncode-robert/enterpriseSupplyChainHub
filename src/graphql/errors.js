/**
 * GraphQL error primitives shared by the parser, validator, and executor.
 * Keeping a single error class means HTTP, tests, and the UI all receive the
 * same stable JSON shape: { message, locations, path, extensions }.
 */

export class GraphQLError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'GraphQLError';
    this.locations = options.locations ?? null;
    this.path = options.path ?? null;
    this.extensions = { code: 'GRAPHQL_ERROR', ...(options.extensions ?? {}) };
    if (options.originalError) this.originalError = options.originalError;
  }

  toJSON() {
    const out = { message: this.message };
    if (this.locations?.length) out.locations = this.locations;
    if (this.path?.length) out.path = this.path;
    if (this.extensions) out.extensions = this.extensions;
    return out;
  }
}

export class GraphQLSyntaxError extends GraphQLError {
  constructor(message, location) {
    super(`Syntax Error: ${message}`, {
      locations: location ? [{ line: location.line, column: location.column }] : undefined,
      extensions: { code: 'GRAPHQL_PARSE_FAILED' },
    });
    this.name = 'GraphQLSyntaxError';
  }
}

export class GraphQLValidationError extends GraphQLError {
  constructor(message, node) {
    super(message, {
      locations: node?.loc ? [{ line: node.loc.line, column: node.loc.column }] : undefined,
      extensions: { code: 'GRAPHQL_VALIDATION_FAILED' },
    });
    this.name = 'GraphQLValidationError';
  }
}

export function locatedError(error, nodes, path) {
  if (error instanceof GraphQLError) {
    if (!error.path) error.path = path;
    return error;
  }
  const node = Array.isArray(nodes) ? nodes[0] : nodes;
  return new GraphQLError(error?.message ?? String(error), {
    locations: node?.loc ? [{ line: node.loc.line, column: node.loc.column }] : undefined,
    path,
    originalError: error,
    extensions: { code: 'INTERNAL_SERVER_ERROR' },
  });
}

export function formatError(error) {
  if (error instanceof GraphQLError) return error.toJSON();
  return {
    message: 'Internal server error',
    extensions: { code: 'INTERNAL_SERVER_ERROR' },
  };
}
