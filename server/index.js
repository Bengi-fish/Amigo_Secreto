import { createPool, migrate } from './db.js';
import { createApp } from './app.js';
const production = process.env.NODE_ENV === 'production';
if (production && (!process.env.APP_ORIGIN || !process.env.APP_ORIGIN.startsWith('https://'))) throw new Error('APP_ORIGIN debe ser la URL HTTPS exacta de Vercel.');
const pool = await createPool();
await migrate(pool);
const app = await createApp(pool, { origin: process.env.APP_ORIGIN || 'http://localhost:3000', production });
const server = app.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.log('Amigo Secreto listo.'));
const cleanup = setInterval(() => {
  Promise.all([pool.query('DELETE FROM sessions WHERE expires_at<NOW()'), pool.query('DELETE FROM rate_limits WHERE resets_at<NOW()')]).catch(() => console.error('No se pudo limpiar sesiones expiradas.'));
}, 15 * 60 * 1000);
cleanup.unref();
function stop() { clearInterval(cleanup); server.close(async () => { await pool.end(); process.exit(0); }); }
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
