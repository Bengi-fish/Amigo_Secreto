import express from 'express';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { transaction } from './db.js';
import { hashPassword, verifyPassword, digest, token, draw, validPassword } from './security.js';

const fail = (status, message) => Object.assign(new Error(message), { status });
function accountInput(body) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
  if (name.length < 2 || name.length > 80 || !/^[a-z0-9_.-]{3,40}$/.test(username))
    throw fail(400, 'Escribe un nombre de 2 a 80 caracteres y un usuario de 3 a 40 (letras, números, punto, guion).');
  return { name, username };
}

export async function createApp(pool, { origin = 'http://localhost:3000', production = false } = {}) {
  const app = express();
  const dummy = await hashPassword(token());
  const cookieName = production ? '__Host-amigo' : 'amigo';
  const cookieOptions = { httpOnly: true, secure: production, sameSite: 'lax', path: '/', maxAge: 8 * 60 * 60 * 1000 };
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: { directives: { 'script-src': ["'self'"], 'style-src': ["'self'"], 'upgrade-insecure-requests': production ? [] : null } }, strictTransportSecurity: production ? undefined : false }));
  app.use(express.json({ limit: '8kb' }));
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && (req.get('origin') !== origin || !req.is('application/json')))
      return next(fail(403, 'Solicitud no permitida. Abre la aplicación desde su dirección oficial.'));
    next();
  });
  app.get('/api/health', async (req, res) => { await pool.query('SELECT 1'); res.json({ ok: true }); });
  async function limit(key, max, minutes) {
    const { rows } = await pool.query(`INSERT INTO rate_limits (key,hits,resets_at) VALUES ($1,1,NOW()+$2::int*INTERVAL '1 minute')
      ON CONFLICT (key) DO UPDATE SET hits=CASE WHEN rate_limits.resets_at < NOW() THEN 1 ELSE rate_limits.hits+1 END,
      resets_at=CASE WHEN rate_limits.resets_at < NOW() THEN EXCLUDED.resets_at ELSE rate_limits.resets_at END RETURNING hits`, [key, minutes]);
    if (rows[0].hits > max) throw fail(429, 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.');
  }
  async function loginSession(res, userId, db = pool) {
    const raw = token();
    await db.query("INSERT INTO sessions (token_hash,user_id,expires_at) VALUES ($1,$2,NOW()+INTERVAL '8 hours')", [digest(raw), userId]);
    res.cookie(cookieName, raw, cookieOptions);
  }
  app.post('/api/login', async (req, res) => {
    const username = typeof req.body.username === 'string' ? req.body.username.trim().toLowerCase().slice(0, 100) : '';
    const password = req.body.password;
    await limit(`login:${digest(username)}`, 10, 15);
    // Global cap is shared by replicas and does not trust forgeable forwarded IP headers.
    await limit('login:global', 300, 15);
    if (typeof password !== 'string' || password.length > 128) throw fail(401, 'Usuario o contraseña incorrectos.');
    await transaction(pool, async db => {
      await db.query('SELECT id FROM game WHERE id=1 FOR UPDATE');
      const { rows } = await db.query('SELECT * FROM users WHERE username=$1', [username]);
      const user = rows[0];
      const valid = await verifyPassword(password, user?.password_hash || dummy);
      if (!user || !valid) throw fail(401, 'Usuario o contraseña incorrectos.');
      await loginSession(res, user.id, db);
    });
    res.json({ ok: true });
  });
  app.use('/api', async (req, res, next) => {
    const raw = (req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
    if (!raw) throw fail(401, 'Inicia sesión para continuar.');
    const { rows } = await pool.query(`SELECT u.*,s.token_hash FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.token_hash=$1 AND s.expires_at>NOW()`, [digest(raw)]);
    if (!rows.length) throw fail(401, 'Tu sesión terminó. Vuelve a iniciar sesión.');
    req.user = rows[0];
    next();
  });
  app.post('/api/logout', async (req, res) => {
    await pool.query('DELETE FROM sessions WHERE token_hash=$1', [req.user.token_hash]);
    res.clearCookie(cookieName, { ...cookieOptions, maxAge: undefined });
    res.json({ ok: true });
  });
  app.get('/api/me', async (req, res) => {
    const { rows: [game] } = await pool.query(`SELECT g.locked,
      (SELECT COUNT(*)::int FROM users WHERE role='participant') AS total,
      (SELECT COUNT(*)::int FROM users WHERE role='participant' AND NOT must_change_password) AS ready
      FROM game g WHERE id=1`);
    const { id, username, name, role, must_change_password } = req.user;
    let recipient = null;
    if (role === 'participant') {
      const { rows } = await pool.query(`SELECT u.name FROM reveals r JOIN assignments a ON a.giver_id=r.user_id
        JOIN users u ON u.id=a.recipient_id WHERE r.user_id=$1`, [id]);
      recipient = rows[0]?.name || null;
    }
    res.json({ user: { id, username, name, role, mustChangePassword: must_change_password }, game, recipient });
  });
  app.post('/api/password', async (req, res) => {
    await limit(`password:${req.user.id}`, 10, 15);
    const { currentPassword, newPassword } = req.body;
    if (!validPassword(newPassword) || typeof currentPassword !== 'string' || currentPassword.length > 128)
      throw fail(400, 'La contraseña nueva debe tener entre 12 y 128 caracteres.');
    if (newPassword === currentPassword) throw fail(400, 'Elige una contraseña diferente a la inicial.');
    const hash = await hashPassword(newPassword);
    await transaction(pool, async db => {
      await db.query('SELECT id FROM game WHERE id=1 FOR UPDATE');
      const { rows: [user] } = await db.query('SELECT * FROM users WHERE id=$1 FOR UPDATE', [req.user.id]);
      if (!await verifyPassword(currentPassword, user.password_hash)) throw fail(400, 'La contraseña actual no es correcta.');
      await db.query('UPDATE users SET password_hash=$1,must_change_password=FALSE WHERE id=$2', [hash, user.id]);
      await db.query('DELETE FROM sessions WHERE user_id=$1', [user.id]);
      await loginSession(res, req.user.id, db);
    });
    res.json({ ok: true });
  });
  app.post('/api/reveal', async (req, res) => {
    if (req.user.role !== 'participant') throw fail(403, 'El administrador no participa en el sorteo.');
    const recipient = await transaction(pool, async db => {
      const { rows: [game] } = await db.query('SELECT locked FROM game WHERE id=1 FOR UPDATE');
      // Recheck session inside the lock: a simultaneous admin reset must revoke access.
      const { rows: active } = await db.query('SELECT 1 FROM sessions WHERE token_hash=$1 AND expires_at>NOW()', [req.user.token_hash]);
      if (!active.length) throw fail(401, 'Vuelve a iniciar sesión.');
      const { rows: participants } = await db.query("SELECT id,must_change_password FROM users WHERE role='participant' ORDER BY id");
      if (participants.some(u => u.must_change_password)) throw fail(409, 'Todos deben cambiar su contraseña inicial antes del sorteo.');
      if (participants.length < 3) throw fail(409, 'Se necesitan al menos 3 participantes.');
      if (!game.locked) {
        for (const [giver, receiver] of draw(participants.map(u => u.id))) {
          await db.query('INSERT INTO assignments (giver_id,recipient_id) VALUES ($1,$2)', [giver, receiver]);
        }
        await db.query('UPDATE game SET locked=TRUE WHERE id=1');
      }
      await db.query('INSERT INTO reveals (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [req.user.id]);
      const { rows } = await db.query('SELECT u.name FROM assignments a JOIN users u ON u.id=a.recipient_id WHERE a.giver_id=$1', [req.user.id]);
      return rows[0].name;
    });
    res.json({ recipient });
  });
  app.use('/api/admin', (req, res, next) => {
    if (req.user.role !== 'admin') return next(fail(403, 'No tienes acceso a este panel.'));
    next();
  });
  app.get('/api/admin/users', async (req, res) => {
    const { rows } = await pool.query("SELECT id,name,username,must_change_password AS pending FROM users WHERE role='participant' ORDER BY created_at,id");
    res.json({ users: rows });
  });
  async function editRoster(fn) {
    return transaction(pool, async db => {
      const { rows: [game] } = await db.query('SELECT locked FROM game WHERE id=1 FOR UPDATE');
      if (game.locked) throw fail(409, 'El sorteo comenzó. Las cuentas ya no se pueden modificar.');
      return fn(db);
    });
  }
  app.post('/api/admin/users', async (req, res) => {
    const { name, username } = accountInput(req.body);
    if (!validPassword(req.body.password)) throw fail(400, 'La contraseña inicial debe tener entre 12 y 128 caracteres.');
    const hash = await hashPassword(req.body.password);
    await editRoster(async db => {
      const { rows: [count] } = await db.query("SELECT COUNT(*)::int AS n FROM users WHERE role='participant'");
      if (count.n >= 200) throw fail(400, 'El máximo es de 200 participantes.');
      await db.query("INSERT INTO users (id,name,username,password_hash,role) VALUES ($1,$2,$3,$4,'participant')", [randomUUID(), name, username, hash]);
    });
    res.status(201).json({ ok: true });
  });
  app.patch('/api/admin/users/:id', async (req, res) => {
    const { name, username } = accountInput(req.body);
    if (req.body.password && !validPassword(req.body.password)) throw fail(400, 'La contraseña debe tener entre 12 y 128 caracteres.');
    const hash = req.body.password ? await hashPassword(req.body.password) : null;
    await editRoster(async db => {
      const { rowCount } = await db.query(`UPDATE users SET name=$1,username=$2,password_hash=COALESCE($3,password_hash),
        must_change_password=CASE WHEN $3::text IS NULL THEN must_change_password ELSE TRUE END WHERE id=$4 AND role='participant'`, [name, username, hash, req.params.id]);
      if (!rowCount) throw fail(404, 'Participante no encontrado.');
      await db.query('DELETE FROM sessions WHERE user_id=$1', [req.params.id]);
    });
    res.json({ ok: true });
  });
  app.delete('/api/admin/users/:id', async (req, res) => {
    await editRoster(async db => {
      const { rowCount } = await db.query("DELETE FROM users WHERE id=$1 AND role='participant'", [req.params.id]);
      if (!rowCount) throw fail(404, 'Participante no encontrado.');
    });
    res.json({ ok: true });
  });
  app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));
  app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));
  app.use((error, req, res, next) => {
    const status = error.status || (error.code === '23505' ? 409 : error.code === '22P02' ? 400 : 500);
    if (status === 500) console.error('Error de servidor:', error.code || error.name);
    res.status(status).json({ error: error.code === '23505' ? 'Ese usuario ya existe.' : status >= 500 ? 'No se pudo completar la operación. Inténtalo de nuevo.' : status === 400 && !error.status ? 'Datos no válidos.' : error.message });
  });
  return app;
}
