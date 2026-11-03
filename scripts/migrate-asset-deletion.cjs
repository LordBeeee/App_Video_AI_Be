const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const client = new Client({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

async function main() {
  await client.connect();
  await client.query('BEGIN');
  try {
    await client.query(
      fs.readFileSync(
        path.join(
          __dirname,
          '../migrations/202611030002_asset_deletion_jobs.sql',
        ),
        'utf8',
      ),
    );
    await client.query('COMMIT');
    process.stdout.write('Asset deletion migration completed.\n');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
main()
  .catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => client.end());
