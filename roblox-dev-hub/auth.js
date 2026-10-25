// Accès au site : IDs d'accès créés par l'admin (valables 30 jours par défaut)
// et une clé admin permanente, générée au premier lancement et gardée sur le PC.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR } = require('./db');

const KEY_FILE = path.join(DATA_DIR, 'CLE-ADMIN.txt');
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans O/0 ni I/1 pour éviter les confusions
const DAY = 86400e3;

function randomCode(prefix, groups = 3) {
  const bytes = crypto.randomBytes(groups * 4);
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
  return prefix + '-' + chars.match(/.{4}/g).join('-');
}

const hash = (s) => crypto.createHash('sha256').update(s).digest('hex');
const clean = (s) => String(s || '').trim().toUpperCase().replace(/\s+/g, '');

function sameText(a, b) {
  const x = Buffer.from(hash(a));
  const y = Buffer.from(hash(b));
  return crypto.timingSafeEqual(x, y);
}

class Auth {
  constructor({ getState, persist }) {
    Object.assign(this, { getState, persist });
    this.fails = new Map(); // ip -> { n, until }
  }

  get data() {
    const st = this.getState();
    st.auth = st.auth || { codes: [], sessions: {} };
    return st.auth;
  }

  // La clé admin permanente : créée une seule fois, stockée dans data/CLE-ADMIN.txt.
  masterKey() {
    if (!this.key) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      if (fs.existsSync(KEY_FILE)) this.key = clean(fs.readFileSync(KEY_FILE, 'utf8').split('\n').find((l) => l.startsWith('ADMIN-')) || '');
      if (!this.key) {
        this.key = randomCode('ADMIN', 5);
        fs.writeFileSync(KEY_FILE, `${this.key}\n\nClé admin permanente de Roblox Dev Hub.\nElle n'expire jamais et donne accès au panneau admin. Ne la partage pas.\n`);
      }
    }
    return this.key;
  }

  resetMasterKey() {
    fs.rmSync(KEY_FILE, { force: true });
    this.key = null;
    const d = this.data;
    for (const [k, s] of Object.entries(d.sessions)) if (s.role === 'admin') delete d.sessions[k];
    this.persist();
    return this.masterKey();
  }

  login(input, ip) {
    const f = this.fails.get(ip);
    if (f && f.n >= 8 && Date.now() < f.until) throw Object.assign(new Error('Trop d\'essais. Réessaie dans 15 minutes.'), { code: 429 });
    const code = clean(input);
    const d = this.data;
    let session;
    if (code && sameText(code, this.masterKey())) {
      session = { role: 'admin', codeId: null, label: 'Admin', expiresAt: new Date(Date.now() + 365 * DAY).toISOString() };
    } else {
      const c = d.codes.find((x) => x.code === code);
      const err = !c ? 'ID inconnu' : c.revoked ? 'Cet ID a été bloqué' : Date.now() > Date.parse(c.expiresAt) ? 'Cet ID a expiré' : '';
      if (err) {
        const cur = f && Date.now() < f.until ? f : { n: 0 };
        this.fails.set(ip, { n: cur.n + 1, until: Date.now() + 15 * 60e3 });
        throw Object.assign(new Error(err), { code: 401 });
      }
      c.lastUsed = new Date().toISOString();
      c.uses = (c.uses || 0) + 1;
      session = { role: 'user', codeId: c.id, label: c.label, expiresAt: c.expiresAt };
    }
    this.fails.delete(ip);
    const token = crypto.randomBytes(32).toString('hex');
    d.sessions[hash(token)] = { ...session, createdAt: new Date().toISOString() };
    this.persist();
    return { token, ...session };
  }

  // Renvoie la session valide liée au jeton, ou null.
  check(token) {
    if (!token) return null;
    const d = this.data;
    const s = d.sessions[hash(token)];
    if (!s || Date.now() > Date.parse(s.expiresAt)) return null;
    if (s.role === 'user') {
      const c = d.codes.find((x) => x.id === s.codeId);
      if (!c || c.revoked || Date.now() > Date.parse(c.expiresAt)) return null;
    }
    return s;
  }

  // Jeton « Bearer » pour les clients MCP distants : clé admin ou ID valide.
  checkCode(input) {
    const code = clean(input);
    if (!code) return null;
    if (sameText(code, this.masterKey())) return { role: 'admin' };
    const c = this.data.codes.find((x) => x.code === code);
    return c && !c.revoked && Date.now() <= Date.parse(c.expiresAt) ? { role: 'user' } : null;
  }

  logout(token) {
    if (token) delete this.data.sessions[hash(token)];
    this.persist();
  }

  create({ label = '', days = 30 } = {}) {
    const d = this.data;
    let code;
    do code = randomCode('RDH'); while (d.codes.some((c) => c.code === code));
    const c = {
      id: crypto.randomBytes(6).toString('hex'), code, label: String(label).trim().slice(0, 60),
      createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + Math.max(1, Number(days) || 30) * DAY).toISOString(),
      revoked: false, lastUsed: null, uses: 0,
    };
    d.codes.unshift(c);
    this.persist();
    return c;
  }

  list() {
    const now = Date.now();
    const active = Object.values(this.data.sessions).filter((s) => now <= Date.parse(s.expiresAt));
    return this.data.codes.map((c) => ({
      ...c,
      status: c.revoked ? 'bloqué' : now > Date.parse(c.expiresAt) ? 'expiré' : 'actif',
      sessions: active.filter((s) => s.codeId === c.id).length,
    }));
  }

  update(id, { revoked, addDays }) {
    const c = this.data.codes.find((x) => x.id === id);
    if (!c) throw Object.assign(new Error('ID introuvable'), { code: 404 });
    if (typeof revoked === 'boolean') c.revoked = revoked;
    if (addDays) c.expiresAt = new Date(Math.max(Date.now(), Date.parse(c.expiresAt)) + Number(addDays) * DAY).toISOString();
    this.persist();
    return c;
  }

  remove(id) {
    const d = this.data;
    d.codes = d.codes.filter((c) => c.id !== id);
    for (const [k, s] of Object.entries(d.sessions)) if (s.codeId === id) delete d.sessions[k];
    this.persist();
  }

  // Nettoyage des sessions expirées.
  sweep() {
    const d = this.data;
    let n = 0;
    for (const [k, s] of Object.entries(d.sessions)) if (Date.now() > Date.parse(s.expiresAt)) { delete d.sessions[k]; n++; }
    if (n) this.persist();
  }
}

module.exports = { Auth, KEY_FILE };
