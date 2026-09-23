import { randomBytes, scrypt, timingSafeEqual, createHash, randomInt, generateKeyPairSync, createPublicKey, createPrivateKey, diffieHellman, hkdfSync, createCipheriv, createDecipheriv } from 'node:crypto';
import { promisify } from 'node:util';
const derive = promisify(scrypt);
const cost = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await derive(password, salt, 64, cost);
  return `${salt}:${hash.toString('hex')}`;
}
export async function verifyPassword(password, stored) {
  const [salt, value] = stored.split(':');
  const hash = await derive(password, salt, 64, cost);
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

// Assignment encryption. Each participant has an X25519 key pair. The private key is stored only encrypted
// with a key derived from their personal password (never the initial one) or, per session, with the session
// token that only their browser holds. The database alone cannot decrypt any assignment.
function seal(key, data, aad) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad));
  const body = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}
function open(key, box, aad) {
  const raw = Buffer.from(box, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]);
}
const passwordKey = (password, salt) => derive(password, salt, 32, cost);
export async function createKeys(password, userId) {
  const { publicKey, privateKey } = generateKeyPairSync('x25519');
  const privateDer = privateKey.export({ type: 'pkcs8', format: 'der' });
  return { publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'), privateDer, ...await wrapKey(privateDer, password, userId) };
}
export async function wrapKey(privateDer, password, userId) {
  const keySalt = randomBytes(16).toString('hex');
  return { keySalt, privateKeyBox: seal(await passwordKey(password, keySalt), privateDer, userId) };
}
export async function unlockKey(password, user) {
  return open(await passwordKey(password, user.key_salt), user.private_key_box, user.id);
}
const sessionKey = raw => Buffer.from(hkdfSync('sha256', Buffer.from(raw, 'hex'), Buffer.alloc(0), 'amigo-secreto/sesion', 32));
export const sessionBox = (raw, privateDer) => seal(sessionKey(raw), privateDer, 'sesion');
export const sessionUnbox = (raw, box) => open(sessionKey(raw), box, 'sesion');
const sharedKey = (privateKey, publicDer, salt) => Buffer.from(hkdfSync('sha256', diffieHellman({ privateKey, publicKey: createPublicKey({ key: publicDer, format: 'der', type: 'spki' }) }), salt, 'amigo-secreto/asignacion', 32));
// Encrypts to the giver's public key with a fresh ephemeral key; only the giver's private key can open it.
export function sealFor(publicKey, text, giverId) {
  const ephemeral = generateKeyPairSync('x25519');
  const ephemeralDer = ephemeral.publicKey.export({ type: 'spki', format: 'der' });
  return `${ephemeralDer.toString('base64')}.${seal(sharedKey(ephemeral.privateKey, Buffer.from(publicKey, 'base64'), ephemeralDer), Buffer.from(text), giverId)}`;
}
export function openFor(privateDer, sealed, giverId) {
  const [ephemeral, box] = sealed.split('.');
  const ephemeralDer = Buffer.from(ephemeral, 'base64');
  const privateKey = createPrivateKey({ key: privateDer, format: 'der', type: 'pkcs8' });
  return open(sharedKey(privateKey, ephemeralDer, ephemeralDer), box, giverId).toString();
}
