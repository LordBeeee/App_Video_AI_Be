const { Client } = require('pg');
const bcrypt = require('bcrypt');

const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
if (!email || !password || password.length < 12) {
  process.stderr.write('Cần BOOTSTRAP_ADMIN_EMAIL và BOOTSTRAP_ADMIN_PASSWORD (ít nhất 12 ký tự).\n');
  process.exit(1);
}

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
  const hash = await bcrypt.hash(password, 12);
  const result = await client.query(
    `INSERT INTO users (role_id, email, password_hash, full_name, status)
     VALUES (1, $1, $2, 'Administrator', 'active')
     ON CONFLICT (email) DO NOTHING RETURNING id`,
    [email, hash],
  );
  if (!result.rowCount) throw new Error('Email đã tồn tại; không thay đổi tài khoản hiện có.');
  process.stdout.write(`Đã tạo tài khoản admin: ${email}\n`);
}

main()
  .catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => client.end());
