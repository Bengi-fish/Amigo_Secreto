import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createLocalPool } from '../server/local-db.js';
import { migrate } from '../server/db.js';
import { createApp } from '../server/app.js';
import { draw, hashPassword, verifyPassword, unlockKey, sessionUnbox } from '../server/security.js';
let pool, server, url;
const origin = 'http://localhost:3000';
const initial = 'Initial-password-2026!';
const personal = 'My-personal-secret-2026!';
const ids = [];
const sessions = {};
const revealed = {};
async function request(path, { method = 'GET', data, cookie, source = origin } = {}) {
  const response = await fetch(`${url}/api${path}`, { method, headers: { ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}), Origin: source }, body: data === undefined ? undefined : JSON.stringify(data) });
  return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0], headers: response.headers };
}
const user = async id => (await pool.query('SELECT * FROM users WHERE id=$1', [id])).rows[0];
before(async () => {
  pool = await createLocalPool(); await migrate(pool);
  const hash = await hashPassword(initial);
  for (let i = 0; i < 7; i++) {
    const id = randomUUID(); ids.push(id);
    await pool.query('INSERT INTO users (id,username,name,password_hash,role,must_change_password) VALUES ($1,$2,$3,$4,$5,$6)', [id, i === 0 ? 'admin' : `persona${i}`, i === 0 ? 'Admin' : `Persona ${i}`, hash, i === 0 ? 'admin' : 'participant', i !== 0]);
  }
  const app = await createApp(pool, { origin });
  server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  url = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise(resolve => server.close(resolve)); await pool.end(); });
test('uniform derangement invariants across group sizes and repeated draws', () => {
  for (const size of [3, 4, 6, 30, 200]) for (let k = 0; k < 100; k++) {
    const ids = Array.from({ length: size }, (_, i) => i); const pairs = draw(ids);
    assert.equal(new Set(pairs.map(p => p[1])).size, size);
    assert.ok(pairs.every(([a, b]) => a !== b));
  }
  assert.throws(() => draw([1]));
});
test('password hashing is salted and rejects wrong passwords', async () => {
  const a = await hashPassword(initial); const b = await hashPassword(initial);
  assert.notEqual(a, b); assert.ok(await verifyPassword(initial, a)); assert.equal(await verifyPassword('wrong', a), false);
});
test('auth rejects SQL injection, missing sessions, and foreign origins', async () => {
  assert.equal((await request('/me')).status, 401);
  assert.equal((await request('/login', { method: 'POST', data: { username: "' OR 1=1 --", password: initial } })).status, 401);
  assert.equal((await request('/login', { method: 'POST', source: 'https://evil.example', data: { username: 'admin', password: initial } })).status, 403);
  for (let i = 0; i < 7; i++) {
    const username = i ? `persona${i}` : 'admin';
    const r = await request('/login', { method: 'POST', data: { username, password: initial } });
    assert.equal(r.status, 200); assert.match(r.headers.get('set-cookie'), /HttpOnly/); sessions[username] = r.cookie;
  }
});
test('admin can edit/create/remove before drawing; participant cannot', async () => {
  assert.equal((await request('/admin/users', { cookie: sessions.persona1 })).status, 403);
  const cookie = sessions.admin;
  assert.equal((await request('/admin/users', { method: 'POST', cookie, data: { name: 'Invitado', username: 'invitado', password: initial } })).status, 201);
  const list = await request('/admin/users', { cookie });
  const guest = list.data.users.find(u => u.username === 'invitado');
  assert.equal((await request(`/admin/users/${guest.id}`, { method: 'PATCH', cookie, data: { name: 'Invitado nuevo', username: 'invitado2' } })).status, 200);
  assert.equal((await request(`/admin/users/${guest.id}`, { method: 'DELETE', cookie, data: {} })).status, 200);
});
test('draw waits for personal passwords; changing password revokes old session', async () => {
  assert.equal((await request('/reveal', { method: 'POST', cookie: sessions.persona1, data: {} })).status, 409);
  assert.equal((await request('/admin/draw', { method: 'POST', cookie: sessions.admin, data: {} })).status, 409);
  for (let i = 1; i < 7; i++) {
    const old = sessions[`persona${i}`];
    const result = await request('/password', { method: 'POST', cookie: old, data: { currentPassword: initial, newPassword: personal } });
    assert.equal(result.status, 200); sessions[`persona${i}`] = result.cookie;
    assert.equal((await request('/me', { cookie: old })).status, 401);
  }
  const { rows } = await pool.query("SELECT public_key,private_key_box FROM users WHERE role='participant'");
  assert.ok(rows.every(r => r.public_key && r.private_key_box));
});
test('keys never open with the initial password; resets and legacy sessions need a personal login', async () => {
  // The organizer knows the initial password: it must not unlock anyone's key.
  for (let i = 1; i < 7; i++) await assert.rejects(unlockKey(initial, await user(ids[i])));
  // Legacy account: personal password but no keys yet, as before encryption existed.
  await pool.query('UPDATE users SET public_key=NULL,private_key_box=NULL,key_salt=NULL WHERE id=$1', [ids[6]]);
  await pool.query('UPDATE sessions SET key_box=NULL WHERE user_id=$1', [ids[6]]);
  assert.equal((await request('/me', { cookie: sessions.persona6 })).status, 401);
  let list = await request('/admin/users', { cookie: sessions.admin });
  assert.equal(list.data.users.find(u => u.id === ids[6]).relogin, true);
  const blocked = await request('/admin/draw', { method: 'POST', cookie: sessions.admin, data: {} });
  assert.equal(blocked.status, 409); assert.match(blocked.data.error, /Falta 1 participante/);
  const relogin = await request('/login', { method: 'POST', data: { username: 'persona6', password: personal } });
  assert.equal(relogin.status, 200); sessions.persona6 = relogin.cookie;
  assert.ok((await user(ids[6])).public_key);
  // An admin reset discards the keys; the participant must choose a personal password again.
  assert.equal((await request(`/admin/users/${ids[5]}`, { method: 'PATCH', cookie: sessions.admin, data: { name: 'Persona 5', username: 'persona5', password: initial } })).status, 200);
  assert.equal((await user(ids[5])).public_key, null);
  const again = await request('/login', { method: 'POST', data: { username: 'persona5', password: initial } });
  const changed = await request('/password', { method: 'POST', cookie: again.cookie, data: { currentPassword: initial, newPassword: personal } });
  assert.equal(changed.status, 200); sessions.persona5 = changed.cookie;
  list = await request('/admin/users', { cookie: sessions.admin });
  assert.ok(list.data.users.every(u => !u.pending && !u.relogin));
});
test('only the admin starts the draw, once; results are encrypted, complete and permanent', async () => {
  assert.equal((await request('/reveal', { method: 'POST', cookie: sessions.persona1, data: {} })).status, 409);
  assert.equal((await request('/admin/draw', { method: 'POST', cookie: sessions.persona1, data: {} })).status, 403);
  const starts = await Promise.all([1, 2].map(() => request('/admin/draw', { method: 'POST', cookie: sessions.admin, data: {} })));
  assert.deepEqual(starts.map(r => r.status).sort(), [200, 409]);
  const { rows } = await pool.query('SELECT * FROM assignments');
  assert.equal(rows.length, 6);
  assert.deepEqual(Object.keys(rows[0]).sort(), ['giver_id', 'sealed']);
  const results = await Promise.all([1, 2, 3, 1].map(i => request('/reveal', { method: 'POST', cookie: sessions[`persona${i}`], data: {} })));
  assert.ok(results.every(r => r.status === 200)); assert.equal(results[0].data.recipient, results[3].data.recipient);
  assert.equal((await request('/me', { cookie: sessions.persona4 })).data.recipient, null);
  assert.equal((await request('/me', { cookie: sessions.persona1 })).data.recipient, results[0].data.recipient);
  const all = await Promise.all([1, 2, 3, 4, 5, 6].map(i => request('/reveal', { method: 'POST', cookie: sessions[`persona${i}`], data: { recipientId: ids[0] } })));
  all.forEach((r, k) => { revealed[k + 1] = r.data.recipient; assert.notEqual(r.data.recipient, `Persona ${k + 1}`); });
  assert.equal(new Set(Object.values(revealed)).size, 6);
});
test('what the database stores cannot be decrypted by someone reading it', async () => {
  // Session keys need the raw cookie token; the database only has its hash.
  const { rows } = await pool.query("SELECT s.token_hash,s.key_box FROM sessions s JOIN users u ON u.id=s.user_id WHERE u.role='participant'");
  assert.ok(rows.length);
  for (const s of rows) assert.throws(() => sessionUnbox(s.token_hash, s.key_box));
  for (let i = 1; i < 7; i++) await assert.rejects(unlockKey(initial, await user(ids[i])));
});
test('changing the password after the draw keeps the same secret friend', async () => {
  const newer = 'Another-personal-secret-2026!';
  const r = await request('/password', { method: 'POST', cookie: sessions.persona2, data: { currentPassword: personal, newPassword: newer } });
  assert.equal(r.status, 200); sessions.persona2 = r.cookie;
  assert.equal((await request('/me', { cookie: sessions.persona2 })).data.recipient, revealed[2]);
  const login = await request('/login', { method: 'POST', data: { username: 'persona2', password: newer } });
  assert.equal((await request('/me', { cookie: login.cookie })).data.recipient, revealed[2]);
});
test('admin cannot reveal, redraw, mutate roster, reset passwords, or inspect assignments', async () => {
  const cookie = sessions.admin;
  assert.equal((await request('/reveal', { method: 'POST', cookie, data: {} })).status, 403);
  assert.equal((await request('/admin/draw', { method: 'POST', cookie, data: {} })).status, 409);
  const me = await request('/me', { cookie }); assert.equal(me.data.recipient, null);
  const list = await request('/admin/users', { cookie });
  assert.deepEqual(Object.keys(list.data.users[0]).sort(), ['id', 'name', 'pending', 'relogin', 'username']);
  assert.equal((await request(`/admin/users/${ids[1]}`, { method: 'PATCH', cookie, data: { name: 'Changed', username: 'changed', password: initial } })).status, 409);
  assert.equal((await request(`/admin/users/${ids[1]}`, { method: 'DELETE', cookie, data: {} })).status, 409);
  assert.equal((await request('/admin/users', { method: 'POST', cookie, data: { name: 'Late', username: 'late', password: initial } })).status, 409);
  assert.equal((await request('/admin/assignments', { cookie })).status, 404);
});
test('database rejects changing/deleting assignments, roster identity, keys and reopening', async () => {
  await assert.rejects(pool.query('UPDATE assignments SET sealed=sealed'));
  await assert.rejects(pool.query('DELETE FROM assignments'));
  await assert.rejects(pool.query('TRUNCATE assignments'));
  await assert.rejects(pool.query('UPDATE game SET locked=FALSE WHERE id=1'));
  await assert.rejects(pool.query("UPDATE users SET name='Changed' WHERE id=$1", [ids[1]]));
  await assert.rejects(pool.query('UPDATE users SET public_key=NULL WHERE id=$1', [ids[1]]));
  assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM assignments')).rows[0].n, 6);
});
test('preferences work on an existing draw and migration preserves all results', async () => {
  const assignments = (await pool.query('SELECT * FROM assignments ORDER BY giver_id')).rows;
  const reveals = (await pool.query('SELECT * FROM reveals ORDER BY user_id')).rows;
  // Simulate upgrading a drawn database that did not have the new preferences table.
  await pool.query('DROP TABLE participant_preferences');
  await migrate(pool);
  const cookie = sessions.persona1;
  const empty = await request('/preferences', { cookie });
  assert.equal(empty.status, 200);
  assert.equal(empty.data.participants.length, 6);
  assert.ok(empty.data.participants.every(p => !p.sweets.length && !p.gifts.length));
  assert.deepEqual(Object.keys(empty.data.participants[0]).sort(), ['gifts', 'id', 'name', 'sweets', 'username']);
  const data = { sweets: [' Café Juan Valdés ', 'Chocolatina'], gifts: ['Carro de control remoto', 'Libro'] };
  assert.equal((await request('/preferences', { method: 'PUT', cookie, data })).status, 200);
  await migrate(pool);
  const list = await request('/preferences', { cookie: sessions.persona3 });
  const own = list.data.participants.find(p => p.id === ids[1]);
  assert.deepEqual(own.sweets, ['Café Juan Valdés', 'Chocolatina']);
  assert.deepEqual(own.gifts, data.gifts);
  assert.equal((await request('/preferences', { cookie: sessions.admin })).status, 200);
  assert.equal((await request('/preferences', { method: 'PUT', cookie, data: { sweets: [], gifts: [] } })).status, 200);
  const cleared = (await request('/preferences', { cookie })).data.participants.find(p => p.id === ids[1]);
  assert.deepEqual(cleared.sweets, []); assert.deepEqual(cleared.gifts, []);
  assert.deepEqual((await pool.query('SELECT * FROM assignments ORDER BY giver_id')).rows, assignments);
  assert.deepEqual((await pool.query('SELECT * FROM reveals ORDER BY user_id')).rows, reveals);
  assert.equal((await request('/me', { cookie })).data.recipient, revealed[1]);
  assert.equal((await pool.query('SELECT locked FROM game WHERE id=1')).rows[0].locked, true);
});

test('preferences enforce ownership, authentication, origin and input limits', async () => {
  const cookie = sessions.persona1;
  const data = { sweets: ['Chocolate'], gifts: ['Libro'] };
  assert.equal((await request('/preferences')).status, 401);
  assert.equal((await request('/preferences', { method: 'PUT', data })).status, 401);
  assert.equal((await request('/preferences', { method: 'PUT', cookie: sessions.admin, data })).status, 403);
  assert.equal((await request('/preferences', { method: 'PUT', cookie, data, source: 'https://evil.example' })).status, 403);
  for (const invalid of [null, {}, { ...data, userId: ids[2] }, { ...data, gifts: 'Libro' }, { ...data, sweets: [null] }, { ...data, sweets: ['   '] }, { ...data, gifts: ['x'.repeat(121)] }, { ...data, gifts: Array(11).fill('Libro') }]) {
    assert.equal((await request('/preferences', { method: 'PUT', cookie, data: invalid })).status, 400);
  }
  await pool.query('UPDATE users SET must_change_password=TRUE WHERE id=$1', [ids[3]]);
  try {
    assert.equal((await request('/preferences', { cookie: sessions.persona3 })).status, 403);
    assert.equal((await request('/preferences', { method: 'PUT', cookie: sessions.persona3, data })).status, 403);
  } finally { await pool.query('UPDATE users SET must_change_password=FALSE WHERE id=$1', [ids[3]]); }
  assert.equal((await request('/preferences', { method: 'PUT', cookie, data: { sweets: Array(10).fill('x'.repeat(120)), gifts: Array(10).fill('Regalo') } })).status, 200);
  const other = (await request('/preferences', { cookie })).data.participants.find(p => p.id === ids[2]);
  assert.deepEqual(other.sweets, []); assert.deepEqual(other.gifts, []);
});

test('reopening archives the complete draw, keeps preferences and supports another round', async () => {
  const cookie = sessions.admin;
  const assignments = (await pool.query('SELECT * FROM assignments ORDER BY giver_id')).rows;
  const participants = (await pool.query("SELECT * FROM users WHERE role='participant' ORDER BY id")).rows;
  const preferences = (await pool.query('SELECT * FROM participant_preferences ORDER BY user_id')).rows;
  assert.equal((await request('/admin/reopen', { method: 'POST', cookie: sessions.persona2, data: { round: 1 } })).status, 403);
  assert.equal((await request('/admin/draw-history', { cookie: sessions.persona2 })).status, 403);
  assert.equal((await request('/admin/reopen', { method: 'POST', cookie, data: { round: 0 } })).status, 409);
  assert.equal((await request('/admin/reopen', { method: 'POST', cookie, source: 'https://evil.example', data: { round: 1 } })).status, 403);
  // Concurrent clicks archive once; reveal requests cannot race across the reset.
  const results = await Promise.all([1, 2].map(() => request('/admin/reopen', { method: 'POST', cookie, data: { round: 1 } })));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.deepEqual((await pool.query('SELECT * FROM participant_preferences ORDER BY user_id')).rows, preferences);
  assert.deepEqual((await pool.query("SELECT * FROM users WHERE role='participant' ORDER BY id")).rows, participants);
  const archive = (await pool.query('SELECT * FROM draw_history WHERE round=1')).rows[0];
  assert.deepEqual(archive.assignments, assignments);
  assert.equal(archive.participants.length, 6);
  assert.equal(archive.reveals.length, 6);
  assert.deepEqual(archive.preferences, preferences);
  const history = await request('/admin/draw-history', { cookie });
  assert.deepEqual(Object.keys(history.data.rounds[0]).sort(), ['archived_at', 'round', 'total']);
  await assert.rejects(pool.query('DELETE FROM draw_history'));
  await assert.rejects(pool.query('UPDATE draw_history SET round=2'));
  const me = await request('/me', { cookie: sessions.persona1 });
  assert.equal(me.data.recipient, null); assert.equal(me.data.game.locked, false); assert.equal(me.data.game.round, 2);
  assert.equal((await request('/reveal', { method: 'POST', cookie: sessions.persona1, data: {} })).status, 409);
  assert.equal((await request(`/admin/users/${ids[5]}`, { method: 'PATCH', cookie, data: { name: 'Persona 5', username: 'persona5', password: initial } })).status, 200);
  assert.equal((await request('/admin/draw', { method: 'POST', cookie, data: {} })).status, 409);
  const login = await request('/login', { method: 'POST', data: { username: 'persona5', password: initial } });
  const changed = await request('/password', { method: 'POST', cookie: login.cookie, data: { currentPassword: initial, newPassword: personal } });
  assert.equal(changed.status, 200); sessions.persona5 = changed.cookie;
  assert.equal((await request(`/admin/users/${ids[6]}`, { method: 'DELETE', cookie, data: {} })).status, 200);
  assert.equal((await request('/admin/users', { method: 'POST', cookie, data: { name: 'Nueva persona', username: 'nueva', password: initial } })).status, 201);
  const added = await request('/login', { method: 'POST', data: { username: 'nueva', password: initial } });
  assert.equal((await request('/password', { method: 'POST', cookie: added.cookie, data: { currentPassword: initial, newPassword: personal } })).status, 200);
  assert.equal((await request('/admin/draw', { method: 'POST', cookie, data: {} })).status, 200);
  assert.equal((await request('/me', { cookie: sessions.persona1 })).data.recipient, null);
  assert.equal((await request('/admin/reopen', { method: 'POST', cookie, data: { round: 1 } })).status, 409);
  await assert.rejects(pool.query('DELETE FROM assignments'));
  await migrate(pool);
  assert.deepEqual((await pool.query('SELECT * FROM draw_history WHERE round=1')).rows[0], archive);
  assert.equal((await request('/reveal', { method: 'POST', cookie: sessions.persona1, data: {} })).status, 200);
  assert.equal((await request('/admin/reopen', { method: 'POST', cookie, data: { round: 2 } })).status, 200);
  assert.equal((await request('/admin/draw-history', { cookie })).data.rounds.length, 2);
});

test('login throttling and logout', async () => {
  let response;
  for (let i = 0; i < 11; i++) response = await request('/login', { method: 'POST', data: { username: 'nonexistent', password: 'wrong' } });
  assert.equal(response.status, 429);
  assert.equal((await request('/logout', { method: 'POST', cookie: sessions.persona1, data: {} })).status, 200);
  assert.equal((await request('/me', { cookie: sessions.persona1 })).status, 401);
});
