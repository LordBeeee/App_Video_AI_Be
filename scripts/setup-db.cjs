const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const root = path.resolve(__dirname, '..');
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
  const { rows } = await client.query("SELECT to_regclass('public.roles') AS roles");
  if (rows[0].roles) {
    throw new Error('Database đã có bảng roles. Chỉ chạy db:setup trên database trống.');
  }
  const migration = fs.readFileSync(
    path.join(root, 'database/migrations/0001_fresh_install.sql'), 'utf8',
  );
  const seed = fs.readFileSync(
    path.join(root, 'database/seeds/0001_roles.sql'), 'utf8',
  );
  await client.query('BEGIN');
  try {
    await client.query(migration);
    await client.query(seed);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
  process.stdout.write('Đã tạo schema và roles cho database mới.\n');
}

main()
  .catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => client.end());
