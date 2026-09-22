import { randomBytes, scrypt, timingSafeEqual, createHash, randomInt } from 'node:crypto';
import { promisify } from 'node:util';
const derive = promisify(scrypt);
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await derive(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `${salt}:${hash.toString('hex')}`;
}
export async function verifyPassword(password, stored) {
  const [salt, value] = stored.split(':');
  const hash = await derive(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return timingSafeEqual(hash, Buffer.from(value, 'hex'));
}
export const digest = value => createHash('sha256').update(value).digest('hex');
export const token = () => randomBytes(32).toString('hex');
export const validPassword = value => typeof value === 'string' && value.length >= 12 && value.length <= 128;
// Rejection sampling over Fisher-Yates: uniform over all derangements, including multiple cycles.
export function draw(ids) {
  if (ids.length < 3) throw new Error('Se necesitan al menos 3 participantes.');
  let shuffled;
  do {
    shuffled = [...ids];
    for (let i = ids.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
  } while (ids.some((id, i) => id === shuffled[i]));
  return ids.map((id, i) => [id, shuffled[i]]);
}
