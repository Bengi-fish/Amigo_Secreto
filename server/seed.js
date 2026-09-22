import { randomUUID, randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { createPool, migrate, transaction } from './db.js';
import { hashPassword, validPassword } from './security.js';
const password = process.env.ADMIN_PASSWORD;
const username = process.env.ADMIN_USERNAME || 'admin';
if (!validPassword(password)) throw new Error('Define ADMIN_PASSWORD con al menos 12 caracteres antes de crear las cuentas.');
if (!/^[a-z0-9_.-]{3,40}$/.test(username)) throw new Error('ADMIN_USERNAME no válido.');
const count = Number(process.env.SEED_PARTICIPANTS || 6);
if (!Number.isInteger(count) || count < 3 || count > 200) throw new Error('SEED_PARTICIPANTS debe estar entre 3 y 200.');
const pool = await createPool();
try {
  await migrate(pool);
  const accounts = [{ id: randomUUID(), name: 'Administrador', username, password, role: 'admin' }];
  for (let i = 1; i <= count; i++) accounts.push({ id: randomUUID(), name: `Participante ${i}`, username: `persona${i}`, password: randomBytes(15).toString('base64url'), role: 'participant' });
  const hashes = [];
  for (const account of accounts) hashes.push(await hashPassword(account.password));
  const filename = `credentials-${Date.now()}.txt`;
  // Write before committing: a disk error cannot create accounts with lost passwords.
  await transaction(pool, async db => {
    await db.query('SELECT id FROM game WHERE id=1 FOR UPDATE');
    const { rows: [row] } = await db.query('SELECT COUNT(*)::int AS count FROM users');
    if (row.count) throw new Error('Ya existen cuentas. El seed no cambia usuarios ni sorteos existentes.');
    for (const [i, account] of accounts.entries()) await db.query('INSERT INTO users (id,name,username,password_hash,role,must_change_password) VALUES ($1,$2,$3,$4,$5,$6)', [account.id, account.name, account.username, hashes[i], account.role, account.role !== 'admin']);
    await writeFile(filename, accounts.map(a => `${a.name}\nUsuario: ${a.username}\nContraseña inicial: ${a.password}\n`).join('\n'), { mode: 0o600, flag: 'wx' });
  });
  console.log(`Cuentas creadas. Credenciales guardadas en ${filename}. Entrégalas de forma privada y elimina ese archivo.`);
} finally { await pool.end(); }
