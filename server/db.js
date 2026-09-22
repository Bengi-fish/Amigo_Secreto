import pg from 'pg';
import { readFile } from 'node:fs/promises';
export async function createPool() {
  if (process.env.LOCAL_DATABASE && process.env.NODE_ENV !== 'production') {
    const { createLocalPool } = await import('./local-db.js');
    return createLocalPool(process.env.LOCAL_DATABASE);
  }
  if (!process.env.DATABASE_URL) throw new Error('Configura DATABASE_URL en .env o Railway.');
  return new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
}
export async function migrate(db) {
  await db.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
}
export async function transaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const value = await fn(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
