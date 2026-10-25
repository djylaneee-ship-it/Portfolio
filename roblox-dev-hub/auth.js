// Accès au site : IDs d'accès créés par l'admin et clé admin permanente.
// Les IDs sont gardés en ligne (cloud.js) : un ID créé sur le PC de l'admin marche sur n'importe
// quel PC. Sans internet, on retombe sur la clé admin de ce PC et les IDs déjà connus ici.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR } = require('./db');
const cloud = require('./cloud');

const KEY_FILE = path.join(DATA_DIR, 'CLE-ADMIN.txt');
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans O/0 ni I/1 pour éviter les confusions
const DAY = 86400e3;
const RECHECK = 10 * 60e3; // une session en ligne est revérifiée toutes les 10 minutes (ID bloqué, expiré…)

function randomCode(prefix, groups = 3) {
  const bytes = crypto.randomBytes(groups * 4);
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
  return prefix + '-' + chars.match(/.{4}/g).join('-');
}

const hash = (s) => crypto.createHash('sha256').update(s).digest('hex');
const clean = (s) => String(s || '').trim().toUpperCase().replace(/\s+/g, '');
const err = (key, code = 401) => Object.assign(new Error(key), { key, code });
const yearFromNow = () => new Date(Date.now() + 365 * DAY).toISOString();

function sameText(a, b) {
  const x = Buffer.from(hash(a));
  const y = Buffer.from(hash(b));
  return crypto.timingSafeEqual(x, y);
}

function withStatus(c) {
  return { ...c, status: c.revoked ? 'blocked' : c.expiresAt && Date.now() > Date.parse(c.expiresAt) ? 'expired' : 'active' };
}

class Auth {
  constructor({ getState, persist }) {
    Object.assign(this, { getState, persist });
    this.fails = new Map(); // ip -> { n, until }
    this.cache = new Map(); // code -> { role, until } (jetons Bearer vérifiés en ligne)
    this.checking = new Set();
    this.online = cloud.enabled;
  }

  get data() {
    const st = this.getState();
    st.auth = st.auth || { codes: [], sessions: {} };
    return st.auth;
  }

  // La clé admin permanente de ce PC, stockée dans data/CLE-ADMIN.txt.
  masterKey() {
    if (!this.key) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      if (fs.existsSync(KEY_FILE)) this.key = clean(fs.readFileSync(KEY_FILE, 'utf8').split('\n').find((l) => l.startsWith('ADMIN-')) || '');
      if (!this.key) this.saveKey(randomCode('ADMIN', 5));
    }
    return this.key;
  }

  saveKey(key) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(KEY_FILE, `${key}\n\nRovex Hub permanent admin key: never expires, opens the admin panel. Do not share it.\nClé admin permanente de Rovex Hub : n'expire jamais, ouvre le panneau admin. Ne la partage pas.\n`);
    this.key = key;
  }

  failed(ip) {
    const f = this.fails.get(ip);
    const cur = f && Date.now() < f.until ? f : { n: 0 };
    this.fails.set(ip, { n: cur.n + 1, until: Date.now() + 15 * 60e3 });
  }

  async login(input, ip) {
    const f = this.fails.get(ip);
    if (f && f.n >= 8 && Date.now() < f.until) throw Object.assign(new Error('Too many attempts. Try again in 15 minutes.'), { code: 429, key: 'tooMany' });
    const code = clean(input);
    let session;
    try {
      session = this.online ? await this.cloudLogin(code) : this.localLogin(code);
    } catch (e) {
      // Pas d'internet : la clé admin de ce PC et les IDs déjà connus ici marchent encore.
      if (e.offline) session = this.localLogin(code, true);
      if (!session) {
        if (!e.offline) this.failed(ip);
        throw e.offline ? Object.assign(e, { code: 503 }) : e;
      }
    }
    this.fails.delete(ip);
    const token = crypto.randomBytes(32).toString('hex');
    const d = this.data;
    d.sessions[hash(token)] = { ...session, createdAt: new Date().toISOString(), checkedAt: Date.now() };
    if (session.cred) d.lastCred = { code: session.cred, role: session.role };
    this.persist();
    return { token, ...session, cred: undefined };
  }

  async cloudLogin(code) {
    if (!code) throw err('unknownId');
    if (sameText(code, this.masterKey())) {
      // Le premier PC admin enregistre sa clé en ligne ; ensuite seule cette clé est la clé principale.
      const c = await cloud.rpc('rovex_claim', { p_key: code });
      if (c.ok) {
        if (c.claimed || !this.data.imported) await this.importLocal(code);
        return { role: 'admin', codeId: null, label: 'Admin', master: true, cloud: true, cred: code, expiresAt: yearFromNow(), permanent: true };
      }
    }
    const out = await cloud.rpc('rovex_login', { p_code: code });
    if (!out.ok) throw err(out.err || 'unknownId');
    // Connexion avec la clé principale depuis un autre PC (co-admin) : elle devient la clé de ce PC.
    if (out.master && code !== this.masterKey()) this.saveKey(code);
    return {
      role: out.role, codeId: out.id || null, label: out.label || '', master: Boolean(out.master), cloud: true, cred: code,
      expiresAt: out.expiresAt || yearFromNow(), permanent: Boolean(out.permanent),
    };
  }

  // IDs créés avant la base en ligne : envoyés une fois, par la clé admin principale.
  async importLocal(key) {
    const codes = this.data.codes || [];
    try {
      if (codes.length) cloud.must(await cloud.rpc('rovex_import', { p_key: key, p_codes: codes }));
      this.data.imported = true;
    } catch {}
  }

  localLogin(code, offline = false) {
    const d = this.data;
    if (code && sameText(code, this.masterKey())) {
      return { role: 'admin', codeId: null, label: 'Admin', master: true, cred: code, cloud: this.online, offline, expiresAt: yearFromNow(), permanent: true };
    }
    const c = d.codes.find((x) => x.code === code);
    const e = !c ? 'unknownId' : c.revoked ? 'idBlocked' : c.expiresAt && Date.now() > Date.parse(c.expiresAt) ? 'idExpired' : '';
    if (e) {
      if (offline) return null;
      throw err(e);
    }
    c.lastUsed = new Date().toISOString();
    c.uses = (c.uses || 0) + 1;
    // Session : jusqu'à l'expiration de l'ID, ou 1 an (renouvelable) pour un ID permanent.
    return { role: c.admin ? 'admin' : 'user', codeId: c.id, label: c.label, cred: code, cloud: this.online, offline, expiresAt: c.expiresAt || yearFromNow(), permanent: !c.expiresAt };
  }

  // Renvoie la session valide liée au jeton, ou null.
  check(token) {
    if (!token) return null;
    const d = this.data;
    const key = hash(token);
    const s = d.sessions[key];
    if (!s || Date.now() > Date.parse(s.expiresAt)) return null;
    if (s.cloud) {
      this.recheck(key, s);
      return s;
    }
    if (s.codeId) {
      const c = d.codes.find((x) => x.id === s.codeId);
      if (!c || c.revoked || (c.expiresAt && Date.now() > Date.parse(c.expiresAt))) return null;
    }
    return s;
  }

  // Revérifie en ligne, en arrière-plan, qu'un ID n'a pas été bloqué ou supprimé entre-temps.
  // Une session ouverte hors ligne est réessayée toutes les 30 secondes jusqu'à ce que la base réponde.
  recheck(key, s) {
    const wait = s.offline ? 30e3 : RECHECK;
    if (!s.cred || Date.now() - (s.checkedAt || 0) < wait || this.checking.has(key)) return;
    this.checking.add(key);
    // Clé admin de ce PC : on l'enregistre en ligne si ce n'est pas encore fait (comme à la connexion).
    const ask = s.master && s.cred === this.masterKey()
      ? cloud.rpc('rovex_claim', { p_key: s.cred }).then(async (c) => {
        if (!c.ok) return cloud.rpc('rovex_check', { p_code: s.cred });
        if (c.claimed || !this.data.imported) await this.importLocal(s.cred);
        return { ok: true, role: 'admin', label: 'Admin' };
      })
      : cloud.rpc('rovex_check', { p_code: s.cred });
    ask.then((out) => {
      const d = this.data;
      if (!d.sessions[key]) return;
      if (!out.ok) delete d.sessions[key];
      else {
        Object.assign(d.sessions[key], { checkedAt: Date.now(), role: out.role, label: out.label || d.sessions[key].label, offline: false, cloud: true });
        if (!d.lastCred) d.lastCred = { code: s.cred, role: out.role };
      }
      this.persist();
    }).catch(() => {
      const cur = this.data.sessions[key];
      if (cur) cur.checkedAt = Date.now();
    }).finally(() => this.checking.delete(key));
  }

  // Jeton « Bearer » pour les clients MCP distants : clé admin ou ID valide.
  checkCode(input) {
    const code = clean(input);
    if (!code) return null;
    if (sameText(code, this.masterKey())) return { role: 'admin' };
    const hit = this.cache.get(code);
    if (hit && Date.now() < hit.until) return hit.role ? { role: hit.role } : null;
    if (this.online) {
      // Vérifié en ligne une fois, puis gardé 10 minutes.
      if (!this.checking.has(code)) {
        this.checking.add(code);
        cloud.rpc('rovex_check', { p_code: code })
          .then((out) => this.cache.set(code, { role: out.ok ? out.role : null, until: Date.now() + RECHECK }))
          .catch(() => {}).finally(() => this.checking.delete(code));
      }
      return null;
    }
    const c = this.data.codes.find((x) => x.code === code);
    return c && !c.revoked && !(c.expiresAt && Date.now() > Date.parse(c.expiresAt)) ? { role: c.admin ? 'admin' : 'user' } : null;
  }

  logout(token) {
    if (token) delete this.data.sessions[hash(token)];
    this.persist();
  }

  // ---------- Gestion des IDs (admin) ----------

  // `admin: true` : ID avec les droits admin. `days: 0` : ID permanent (n'expire jamais).
  async create({ label = '', days = 30, admin = false } = {}, session) {
    admin = admin === true || admin === 'true' || admin === 'on';
    days = Number(days);
    const permanent = !days || days < 0;
    const code = admin ? randomCode('ADMIN', 5) : randomCode('RDH');
    if (this.online) {
      const out = cloud.must(await cloud.rpc('rovex_create', { p_key: session.cred, p_code: code, p_label: String(label).trim().slice(0, 60), p_days: permanent ? 0 : days, p_admin: admin }));
      return withStatus(out.code);
    }
    const c = {
      id: crypto.randomBytes(6).toString('hex'), code, label: String(label).trim().slice(0, 60),
      createdAt: new Date().toISOString(), expiresAt: permanent ? null : new Date(Date.now() + days * DAY).toISOString(),
      revoked: false, lastUsed: null, uses: 0, admin,
    };
    this.data.codes.unshift(c);
    this.persist();
    return c;
  }

  async list(session) {
    if (this.online) return cloud.must(await cloud.rpc('rovex_codes', { p_key: session.cred })).codes.map(withStatus);
    return this.data.codes.map(withStatus);
  }

  async update(id, { revoked, addDays, permanent }, session) {
    if (this.online) {
      const out = cloud.must(await cloud.rpc('rovex_update', {
        p_key: session.cred, p_id: id, p_revoked: typeof revoked === 'boolean' ? revoked : null,
        p_add_days: addDays ? Number(addDays) : null, p_permanent: permanent === true ? true : null,
      }));
      if (revoked) this.dropSessions(id);
      return withStatus(out.code);
    }
    const c = this.data.codes.find((x) => x.id === id);
    if (!c) throw err('idNotFound', 404);
    if (typeof revoked === 'boolean') c.revoked = revoked;
    if (permanent === true) c.expiresAt = null;
    if (addDays && c.expiresAt) c.expiresAt = new Date(Math.max(Date.now(), Date.parse(c.expiresAt)) + Number(addDays) * DAY).toISOString();
    this.persist();
    return c;
  }

  async remove(id, session) {
    if (this.online) cloud.must(await cloud.rpc('rovex_delete', { p_key: session.cred, p_id: id }));
    this.data.codes = this.data.codes.filter((c) => c.id !== id);
    this.dropSessions(id);
  }

  dropSessions(codeId) {
    const d = this.data;
    for (const [k, s] of Object.entries(d.sessions)) if (s.codeId === codeId) delete d.sessions[k];
    this.persist();
  }

  // Nouvelle clé admin principale (l'ancienne ne marche plus nulle part).
  async resetMasterKey(session) {
    const key = randomCode('ADMIN', 5);
    if (this.online) cloud.must(await cloud.rpc('rovex_reset_master', { p_key: session.cred, p_new: key }));
    this.saveKey(key);
    const d = this.data;
    for (const [k, s] of Object.entries(d.sessions)) if (s.role === 'admin' && !s.codeId) delete d.sessions[k];
    if (d.lastCred && d.lastCred.role === 'admin') d.lastCred = { code: key, role: 'admin' };
    this.persist();
    return key;
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
