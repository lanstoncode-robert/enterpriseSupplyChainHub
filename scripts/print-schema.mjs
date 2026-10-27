import { schema } from '../src/gateway/index.js';
import { printSchema, schemaToJSON } from '../src/graphql/schema.js';

const format = process.argv.includes('--json') ? 'json' : 'sdl';
if (format === 'json') {
  process.stdout.write(`${JSON.stringify(schemaToJSON(schema), null, 2)}\n`);
} else {
  process.stdout.write(printSchema(schema));
}
