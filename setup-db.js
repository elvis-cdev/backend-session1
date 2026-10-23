require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const schema = process.env.DB_SCHEMA;

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is missing from .env');
  }

  if (!schema || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
    throw new Error('DB_SCHEMA is missing or invalid in .env (example: student01)');
  }

  // schema was checked above, so it is safe to drop into the SQL text
  const sql = fs
    .readFileSync(path.join(__dirname, 'schema.sql'), 'utf8')
    .replaceAll('TEAM_SCHEMA', schema);

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    await client.connect();
    await client.query(sql);
    console.log(`Schema setup completed successfully (schema: ${schema}).`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('Setup failed:', error.message || error);
  process.exitCode = 1;
});
