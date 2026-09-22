import { writeFile, access } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
try { await access('.env'); throw new Error('Ya existe .env. No se sobrescribirá. Usa pnpm seed si necesitas crear las cuentas.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const password = randomBytes(20).toString('base64url');
await writeFile('.env', `LOCAL_DATABASE=.local-db\nAPP_ORIGIN=http://localhost:3000\nPORT=3000\nNODE_ENV=development\nADMIN_USERNAME=admin\nADMIN_PASSWORD=${password}\nSEED_PARTICIPANTS=6\n`, { flag: 'wx', mode: 0o600 });
const result = spawnSync(process.execPath, ['--env-file=.env', 'server/seed.js'], { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status || 1);
console.log('Configuración local lista. Ejecuta pnpm dev y abre http://localhost:3000.');
