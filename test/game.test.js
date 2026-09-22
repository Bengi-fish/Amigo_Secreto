import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createLocalPool } from '../server/local-db.js';
import { migrate } from '../server/db.js';
import { createApp } from '../server/app.js';
import { draw, hashPassword, verifyPassword } from '../server/security.js';
let pool, server, url;
const origin = 'http://localhost:3000';
const initial = 'Initial-password-2026!';
const personal = 'My-personal-secret-2026!';
const ids = [];
const sessions = {};
async function request(path, { method = 'GET', data, cookie, source = origin } = {}) {
  const response = await fetch(`${url}/api${path}`, { method, headers: { ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}), Origin: source }, body: data === undefined ? undefined : JSON.stringify(data) });
  return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0], headers: response.headers };
}
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
  for (let i = 1; i < 7; i++) {
    const old = sessions[`persona${i}`];
    const result = await request('/password', { method: 'POST', cookie: old, data: { currentPassword: initial, newPassword: personal } });
    assert.equal(result.status, 200); sessions[`persona${i}`] = result.cookie;
    assert.equal((await request('/me', { cookie: old })).status, 401);
  }
});
test('simultaneous first reveals create one permanent complete draw', async () => {
  const results = await Promise.all([1, 2, 3, 1].map(i => request('/reveal', { method: 'POST', cookie: sessions[`persona${i}`], data: {} })));
  assert.ok(results.every(r => r.status === 200)); assert.equal(results[0].data.recipient, results[3].data.recipient);
  const { rows } = await pool.query('SELECT * FROM assignments');
  assert.equal(rows.length, 6); assert.equal(new Set(rows.map(r => r.recipient_id)).size, 6); assert.ok(rows.every(r => r.giver_id !== r.recipient_id));
  const hidden = await request('/me', { cookie: sessions.persona4 }); assert.equal(hidden.data.recipient, null);
  const again = await request('/me', { cookie: sessions.persona1 }); assert.equal(again.data.recipient, results[0].data.recipient);
  const all = await Promise.all([1, 2, 3, 4, 5, 6].map(i => request('/reveal', { method: 'POST', cookie: sessions[`persona${i}`], data: { recipientId: ids[0] } })));
  assert.equal(new Set(all.map(r => r.data.recipient)).size, 6);
});
test('admin cannot reveal, mutate roster, reset passwords, or inspect assignments', async () => {
  const cookie = sessions.admin;
  assert.equal((await request('/reveal', { method: 'POST', cookie, data: {} })).status, 403);
  const me = await request('/me', { cookie }); assert.equal(me.data.recipient, null);
  const list = await request('/admin/users', { cookie });
  assert.deepEqual(Object.keys(list.data.users[0]).sort(), ['id', 'name', 'pending', 'username']);
  assert.equal((await request(`/admin/users/${ids[1]}`, { method: 'PATCH', cookie, data: { name: 'Changed', username: 'changed', password: initial } })).status, 409);
  assert.equal((await request(`/admin/users/${ids[1]}`, { method: 'DELETE', cookie, data: {} })).status, 409);
  assert.equal((await request('/admin/users', { method: 'POST', cookie, data: { name: 'Late', username: 'late', password: initial } })).status, 409);
  assert.equal((await request('/admin/assignments', { cookie })).status, 404);
});
test('database rejects changing/deleting assignments, roster identity and reopening', async () => {
  await assert.rejects(pool.query('UPDATE assignments SET recipient_id=recipient_id'));
  await assert.rejects(pool.query('DELETE FROM assignments'));
  await assert.rejects(pool.query('TRUNCATE assignments'));
  await assert.rejects(pool.query('UPDATE game SET locked=FALSE WHERE id=1'));
  await assert.rejects(pool.query("UPDATE users SET name='Changed' WHERE id=$1", [ids[1]]));
  assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM assignments')).rows[0].n, 6);
});
test('login throttling and logout', async () => {
  let response;
  for (let i = 0; i < 11; i++) response = await request('/login', { method: 'POST', data: { username: 'nonexistent', password: 'wrong' } });
  assert.equal(response.status, 429);
  assert.equal((await request('/logout', { method: 'POST', cookie: sessions.persona1, data: {} })).status, 200);
  assert.equal((await request('/me', { cookie: sessions.persona1 })).status, 401);
});
