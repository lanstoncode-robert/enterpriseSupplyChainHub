import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/graphql/parser.js';
import { lex } from '../src/graphql/lexer.js';
import { buildSchema } from '../src/graphql/schema.js';
import { validate } from '../src/graphql/validate.js';
import { execute } from '../src/graphql/execute.js';

const SDL = /* GraphQL */ `
  scalar DateTime

  enum Role { ADMIN OPERATOR VIEWER }

  input UserFilter {
    role: Role
    active: Boolean = true
  }

  type User {
    id: ID!
    name: String!
    role: Role!
    joinedAt: DateTime
    friends: [User!]!
  }

  type Query {
    hello: String!
    user(id: ID!): User
    users(filter: UserFilter, first: Int = 10): [User!]!
  }

  type Mutation {
    renameUser(id: ID!, name: String!): User!
  }
`;

const users = [
  { id: '1', name: 'Ada', role: 'ADMIN', joinedAt: '2024-01-02T03:04:05.000Z', friendIds: ['2'] },
  { id: '2', name: 'Grace', role: 'OPERATOR', joinedAt: '2024-05-06T00:00:00.000Z', friendIds: ['1'] },
  { id: '3', name: 'Linus', role: 'VIEWER', joinedAt: null, friendIds: [] },
];

function makeSchema() {
  const schema = buildSchema(SDL);
  const byId = (id) => users.find((user) => user.id === String(id)) ?? null;
  const hydrate = (user) => user && { ...user, friends: () => user.friendIds.map(byId).filter(Boolean) };

  Object.assign(schema.getType('Query').fields.get('hello'), { resolve: () => 'world' });
  Object.assign(schema.getType('Query').fields.get('user'), {
    resolve: (_source, args) => hydrate(byId(args.id)),
  });
  Object.assign(schema.getType('Query').fields.get('users'), {
    resolve: (_source, args) => users.filter((user) => !args.filter?.role || user.role === args.filter.role).slice(0, args.first).map(hydrate),
  });
  Object.assign(schema.getType('User').fields.get('friends'), {
    resolve: (user) => user.friends(),
  });
  Object.assign(schema.getType('User').fields.get('joinedAt'), {
    resolve: (user) => user.joinedAt,
  });
  Object.assign(schema.getType('Mutation').fields.get('renameUser'), {
    resolve: (_source, args) => {
      const user = byId(args.id);
      if (!user) throw new Error('not found');
      user.name = args.name;
      return hydrate(user);
    },
  });
  return schema;
}

async function run(query, variables = {}, schema = makeSchema(), operationName = null) {
  const document = parse(query);
  const errors = validate(schema, document);
  assert.deepEqual(errors.map((error) => error.message), [], 'document should validate');
  return execute({ schema, document, variableValues: variables, operationName, maskInternalErrors: false });
}

test('lexer tracks positions and supports block strings', () => {
  const tokens = lex('# comment\nquery Q { field(arg: """\n  hello\n  world\n""") }');
  assert.equal(tokens[0].value, 'query');
  assert.equal(tokens[0].line, 2);
  assert.ok(tokens.some((token) => token.kind === 'BLOCK_STRING' && token.value === 'hello\nworld'));
});

test('parser produces operations, fragments, and aliases', () => {
  const document = parse('query Q($id: ID!) { first: user(id: $id) { ...F } } fragment F on User { name }');
  assert.equal(document.definitions.length, 2);
  assert.equal(document.definitions[0].selectionSet.selections[0].alias, 'first');
  assert.equal(document.definitions[0].variableDefinitions[0].name, 'id');
  assert.equal(document.definitions[1].kind, 'FragmentDefinition');
});

test('parser rejects malformed documents with locations', () => {
  assert.throws(() => parse('query { field('), /Syntax Error/);
  assert.throws(() => parse('{ field(arg: ) }'), /Syntax Error/);
});

test('executes fields, aliases, variables, enums, and nested lists', async () => {
  const result = await run(
    `query GetUser($id: ID!) {
      who: user(id: $id) { id name role friends { name } }
    }`,
    { id: '1' },
  );
  assert.equal(result.errors, undefined);
  assert.equal(result.data.who.name, 'Ada');
  assert.equal(result.data.who.role, 'ADMIN');
  assert.deepEqual(result.data.who.friends, [{ name: 'Grace' }]);
});

test('supports fragments, inline fragments, and @skip/@include', async () => {
  const result = await run(
    `query Q($showRole: Boolean!, $skipName: Boolean!) {
      user(id: "2") {
        ...Base
        ... on User { role @include(if: $showRole) }
        name @skip(if: $skipName)
      }
    }
    fragment Base on User { id }`,
    { showRole: false, skipName: true },
  );
  assert.equal(result.errors, undefined);
  assert.deepEqual(result.data.user, { id: '2' });
});

test('applies input object defaults and argument defaults', async () => {
  const result = await run(`{ users(filter: { role: OPERATOR }) { name } }`);
  assert.equal(result.errors, undefined);
  assert.deepEqual(result.data.users, [{ name: 'Grace' }]);
});

test('serializes DateTime and validates variable types', async () => {
  const result = await run(`query Q($id: ID!) { user(id: $id) { joinedAt } }`, { id: '1' });
  assert.equal(result.data.user.joinedAt, '2024-01-02T03:04:05.000Z');

  const document = parse('query Q($id: ID!) { user(id: $id) { name } }');
  const bad = await execute({ schema: makeSchema(), document, variableValues: { id: true } });
  assert.equal(bad.errors[0].extensions.code, 'BAD_USER_INPUT');
});

test('runs mutations serially', async () => {
  const result = await run(`mutation Rename { first: renameUser(id: "3", name: "Linus T") { name } second: renameUser(id: "3", name: "Linus B") { name } }`);
  assert.equal(result.errors, undefined);
  assert.deepEqual(result.data, { first: { name: 'Linus T' }, second: { name: 'Linus B' } });
});

test('bubbles non-null field errors to the nearest nullable parent', async () => {
  const schema = makeSchema();
  Object.assign(schema.getType('Query').fields.get('user'), { resolve: () => ({ id: '1', name: null }) });
  const document = parse('{ user(id: "1") { id name } }');
  const result = await execute({ schema, document, maskInternalErrors: false });
  assert.equal(result.data.user, null);
  assert.match(result.errors[0].message, /non-nullable field User\.name/);
  assert.deepEqual(result.errors[0].path, ['user', 'name']);
});

test('validation catches unknown fields, bad fragments, unused variables, and non-input defaults', () => {
  const schema = makeSchema();
  const cases = [
    ['{ nope }', /Cannot query field "nope"/],
    ['query Q { user(id: "1") { ...Missing } }', /Unknown fragment "Missing"/],
    ['query Q($unused: ID) { hello }', /never used/],
    ['query Q($id: ID) { user(id: $id) { name } }', /used in position expecting type "ID!"/],
    ['query Q { user(id: "1") { id { nested } } }', /must not have a selection/],
    ['fragment F on Query { hello } query Q { hello }', /never used/],
  ];
  for (const [query, pattern] of cases) {
    const errors = validate(schema, parse(query));
    assert.ok(errors.some((error) => pattern.test(error.message)), `${query} should produce ${pattern}; got ${errors.map((e) => e.message).join(' | ')}`);
  }
});

test('validation detects fragment cycles and subscription use', () => {
  const schema = makeSchema();
  const cycle = validate(schema, parse('fragment A on User { ...B } fragment B on User { ...A } query Q { user(id: "1") { ...A } }'));
  assert.ok(cycle.some((error) => /within itself/.test(error.message)));

  const subscription = validate(schema, parse('subscription S { hello }'));
  assert.ok(subscription.some((error) => /Subscriptions are not supported/.test(error.message)));
});
