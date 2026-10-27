import { parse } from '../graphql/parser.js';
import { buildSchema } from '../graphql/schema.js';

const TYPE_KINDS = new Set([
  'ObjectTypeDefinition',
  'InputObjectTypeDefinition',
  'EnumTypeDefinition',
  'ScalarTypeDefinition',
]);

/**
 * Federation-lite schema stitching.
 *
 * Each subgraph owns a slice of SDL and a resolver map. The stitcher:
 *   1. parses every subgraph document,
 *   2. merges duplicate type definitions field-by-field (identical signatures
 *      are allowed, conflicts throw at boot),
 *   3. builds and validates one executable schema,
 *   4. attaches resolvers and rejects cross-subgraph resolver collisions,
 *   5. records an inspectable report exposed by `gatewayInfo`.
 *
 * Cross-subgraph references work because resolvers read only the key fields
 * they need from the source object (for example a traceability record hands
 * `{ id }` to the `Product` resolvers owned by the orders subgraph).
 */
export function stitchSchemas(subgraphs, { version = '1.0.0' } = {}) {
  if (!Array.isArray(subgraphs) || subgraphs.length === 0) throw new Error('At least one subgraph is required.');

  const definitions = [];
  const resolverEntries = new Map();
  const report = [];

  for (const subgraph of subgraphs) {
    if (!subgraph.name || typeof subgraph.typeDefs !== 'string') {
      throw new Error('Each subgraph requires a name and typeDefs string.');
    }
    if (report.some((entry) => entry.name === subgraph.name)) {
      throw new Error(`Duplicate subgraph name "${subgraph.name}".`);
    }
    const document = parse(subgraph.typeDefs);
    definitions.push(...document.definitions);

    const typeDefinitions = document.definitions.filter((definition) => TYPE_KINDS.has(definition.kind));
    const queryFields = document.definitions
      .filter((definition) => (definition.kind === 'ObjectTypeDefinition' || definition.kind === 'ObjectTypeExtension') && definition.name === 'Query')
      .flatMap((definition) => definition.fields?.map((field) => field.name) ?? []);
    const mutationFields = document.definitions
      .filter((definition) => (definition.kind === 'ObjectTypeDefinition' || definition.kind === 'ObjectTypeExtension') && definition.name === 'Mutation')
      .flatMap((definition) => definition.fields?.map((field) => field.name) ?? []);

    let resolverCount = 0;
    for (const [typeName, fields] of Object.entries(subgraph.resolvers ?? {})) {
      for (const [fieldName, resolver] of Object.entries(fields)) {
        if (typeof resolver !== 'function') throw new Error(`Resolver ${subgraph.name}.${typeName}.${fieldName} is not a function.`);
        const key = `${typeName}.${fieldName}`;
        if (resolverEntries.has(key)) {
          throw new Error(
            `Resolver collision on "${key}" between subgraphs "${resolverEntries.get(key).subgraph}" and "${subgraph.name}". ` +
            'A field must have exactly one owner.',
          );
        }
        resolverEntries.set(key, { resolver, subgraph: subgraph.name });
        resolverCount += 1;
      }
    }

    report.push({
      name: subgraph.name,
      typeCount: typeDefinitions.length,
      resolverCount,
      queryFields,
      mutationFields,
    });
  }

  const document = { kind: 'Document', definitions };
  const schema = buildSchema(document, { mergeTypes: true });

  for (const [key, entry] of resolverEntries) {
    const [typeName, fieldName] = key.split('.');
    const type = schema.getType(typeName);
    if (!type || type.kind !== 'OBJECT') {
      throw new Error(`Subgraph "${entry.subgraph}" attached resolver "${key}" to a type that does not exist.`);
    }
    const field = type.fields.get(fieldName);
    if (!field) {
      throw new Error(`Subgraph "${entry.subgraph}" attached resolver "${key}" to a field that does not exist.`);
    }
    field.resolve = entry.resolver;
    field.owner = entry.subgraph;
  }

  for (const rootName of ['Query', 'Mutation']) {
    const root = schema.getType(rootName);
    if (!root) continue;
    for (const field of root.fields.values()) {
      if (!field.resolve) throw new Error(`Root field "${rootName}.${field.name}" has no resolver.`);
    }
  }

  schema.stitch = {
    strategy: 'Federation-lite schema stitching',
    version,
    stitchedAt: new Date().toISOString(),
    subgraphs: report,
    mergedTypeCount: schema.types.size,
    resolverCount: resolverEntries.size,
  };
  return schema;
}
