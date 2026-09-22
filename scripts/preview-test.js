// Disposable UI verification server. Never connects to the local or production database.
import { randomUUID } from 'node:crypto';
import { createLocalPool } from '../server/local-db.js';
import { migrate } from '../server/db.js';
import { hashPassword } from '../server/security.js';
import { createApp } from '../server/app.js';
const pool = await createLocalPool();
await migrate(pool);
const hash = await hashPassword('Only-for-UI-tests-2026!');
for (const [i, name] of ['Administrador', 'Sofía Martínez', 'Daniel López', 'Valentina Rojas', 'Santiago Pérez', 'Camila Torres', 'Mateo García'].entries()) {
  await pool.query('INSERT INTO users(id,username,name,password_hash,role,must_change_password) VALUES($1,$2,$3,$4,$5,FALSE)', [randomUUID(), i ? `persona${i}` : 'admin', name, hash, i ? 'participant' : 'admin']);
}
const app = await createApp(pool, { origin: 'http://127.0.0.1:3001' });
const server = app.listen(3001, '127.0.0.1', () => console.log('Vista de prueba aislada en http://127.0.0.1:3001'));
process.on('SIGINT', () => server.close(async () => { await pool.end(); process.exit(0); }));
