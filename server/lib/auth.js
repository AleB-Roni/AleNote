// Benutzer, Passwörter und Sitzungen
const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const newId = () => crypto.randomBytes(8).toString('hex');

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const key = await scrypt(String(password), salt, 64);
  return `scrypt$${salt}$${key.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, salt, hex] = stored.split('$');
  const key = await scrypt(String(password), salt, 64);
  const expected = Buffer.from(hex, 'hex');
  return expected.length === key.length && crypto.timingSafeEqual(expected, key);
}

const USERNAME_RE = /^[a-zA-Z0-9._-]{2,32}$/;

function validateUsername(name) {
  if (!USERNAME_RE.test(name || '')) throw httpError(400, 'Benutzername: 2–32 Zeichen, nur Buchstaben, Zahlen, . _ -');
}

function validatePassword(pw) {
  if (!pw || String(pw).length < 6) throw httpError(400, 'Passwort muss mindestens 6 Zeichen haben');
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/** Öffentliche Sicht auf einen Benutzer (ohne Passwort-Hash) */
function publicUser(u) {
  if (!u) return null;
  const { passHash, ...rest } = u;
  return rest;
}

// Einfacher Schutz gegen Passwort-Raten: max. 10 Fehlversuche pro 15 Minuten und IP
const attempts = new Map();
function checkRateLimit(ip) {
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter((t) => now - t < 15 * 60e3);
  attempts.set(ip, list);
  if (list.length >= 10) throw httpError(429, 'Zu viele Fehlversuche. Bitte in 15 Minuten erneut versuchen.');
}
function recordFailure(ip) {
  const list = attempts.get(ip) || [];
  list.push(Date.now());
  attempts.set(ip, list);
}

module.exports = { sha256, newId, hashPassword, verifyPassword, validateUsername, validatePassword, httpError, publicUser, checkRateLimit, recordFailure };
