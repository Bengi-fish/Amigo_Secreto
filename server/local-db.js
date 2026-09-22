// Embedded PostgreSQL for local development/tests only. Railway uses pg + PostgreSQL.
import { PGlite } from '@electric-sql/pglite';
export async function createLocalPool(path) {
  const db = new PGlite(path);
  await db.waitReady;
  let tail = Promise.resolve();
  async function acquire() {
    const previous = tail;
    let release;
    tail = new Promise(resolve => { release = resolve; });
    await previous;
    return release;
  }
  async function query(sql, params) {
    if (!params && sql.includes('CREATE TABLE')) { await db.exec(sql); return { rows: [], rowCount: 0 }; }
    const result = await db.query(sql, params);
    return { ...result, rowCount: result.affectedRows ?? result.rows.length };
  }
  return {
    async query(sql, params) { const release = await acquire(); try { return await query(sql, params); } finally { release(); } },
    async connect() { const release = await acquire(); return { query, release }; },
    async end() { await tail; await db.close(); }
  };
}
