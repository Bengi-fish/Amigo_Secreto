// Disposable UI verification server. Never connects to the local or production database.
import { randomUUID } from 'node:crypto';
import { createLocalPool } from '../server/local-db.js';
import { migrate } from '../server/db.js';
import { hashPassword, createKeys, draw, sealFor } from '../server/security.js';
import { createApp } from '../server/app.js';
const pool = await createLocalPool();
await migrate(pool);
const password = 'Only-for-UI-tests-2026!';
const hash = await hashPassword(password);
const participants = [];
for (const [i, name] of ['Administrador', 'Sofía Martínez', 'Daniel López', 'Valentina Rojas', 'Santiago Pérez', 'Camila Torres', 'Mateo García'].entries()) {
  const id = randomUUID();
  // Participants start ready to play: personal password already set and keys created.
  const keys = i ? await createKeys(password, id) : { publicKey: null, privateKeyBox: null, keySalt: null };
  await pool.query('INSERT INTO users(id,username,name,password_hash,role,must_change_password,public_key,private_key_box,key_salt) VALUES($1,$2,$3,$4,$5,FALSE,$6,$7,$8)', [id, i ? `persona${i}` : 'admin', name, hash, i ? 'participant' : 'admin', keys.publicKey, keys.privateKeyBox, keys.keySalt]);
  if (i) participants.push({ id, publicKey: keys.publicKey });
  if (i === 1 || i === 2) await pool.query('INSERT INTO participant_preferences(user_id,sweets,gifts) VALUES($1,$2,$3)', [id, i === 1 ? ['Café Juan Valdés', 'Chocolatina'] : ['Gomitas', 'Arequipe'], i === 1 ? ['Carro de control remoto', 'Un libro de aventuras'] : ['Audífonos', 'Juego de mesa']]);
}
for (const [giver, receiver] of draw(participants.map(person => person.id))) {
  await pool.query('INSERT INTO assignments(giver_id,sealed) VALUES($1,$2)', [giver, sealFor(participants.find(person => person.id === giver).publicKey, receiver, giver)]);
}
await pool.query('UPDATE game SET locked=TRUE WHERE id=1');
const app = await createApp(pool, { origin: 'http://127.0.0.1:3001' });
const server = app.listen(3001, '127.0.0.1', () => console.log('Vista de prueba aislada en http://127.0.0.1:3001'));
process.on('SIGINT', () => server.close(async () => { await pool.end(); process.exit(0); }));
