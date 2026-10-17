const required = [
  'DB_HOST',
  'DB_USERNAME',
  'DB_PASSWORD',
  'DB_DATABASE',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
  'OPENROUTER_API_KEY',
] as const;

export function validateEnv(values: Record<string, unknown>) {
  const missing = required.filter(
    (key) => typeof values[key] !== 'string' || !String(values[key]).trim(),
  );
  if (missing.length) {
    throw new Error(`Thiếu biến môi trường: ${missing.join(', ')}`);
  }

  const port = Number(values.PORT ?? 3000);
  const dbPort = Number(values.DB_PORT ?? 5432);
  for (const [name, value] of [
    ['PORT', port],
    ['DB_PORT', dbPort],
  ] as const) {
    if (!Number.isInteger(value) || value < 1 || value > 65535) {
      throw new Error(`${name} phải là cổng hợp lệ (1–65535)`);
    }
  }
  if (
    values.DB_SSL != null &&
    (typeof values.DB_SSL !== 'string' ||
      !['true', 'false'].includes(values.DB_SSL))
  ) {
    throw new Error('DB_SSL phải là true hoặc false');
  }
  return { ...values, PORT: port, DB_PORT: dbPort };
}
