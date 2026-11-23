// Staff sign in with an email address and a password this app owns. Once email
// is connected, every sign-in also needs a 6-digit code sent to that address.

// Who runs the place on day one. They are created as owner the first time they
// choose a password for this exact email address.
const BOOTSTRAP_OWNER_EMAILS = ['dannyrcollinsjr@gmail.com', 'irishboiblu@gmail.com']

const SESSION_COOKIE = 'staff_session'
const SESSION_DAYS = 14
const CODE_MINUTES = 10
const CODE_TRIES = 5
const MIN_PASSWORD = 10
const FAILURE_WINDOW_MINUTES = 15
const MAX_FAILURES = 8

// The public site lives on GitHub Pages; it reads this app's public config.
const PUBLIC_SITE_ORIGINS = new Set([
  'https://irishboiblu.github.io',
  'https://foss.macaly.app',
])

const ROLES = ['owner', 'admin', 'editor']
const EDITOR_KEYS = new Set([
  'site.name',
  'site.tagline',
  'site.logo_url',
  'header.cta_label',
  'header.cta_url',
  'header.announcement',
  'header.show_announcement',
  'footer.contact_email',
])
const ADMIN_KEYS = new Set([
  ...EDITOR_KEYS,
  'email.provider',
  'email.from_name',
  'email.from_address',
  'email.reply_to',
  'email.api_key',
  'cloudflare.account_id',
  'cloudflare.zone_id',
  'cloudflare.api_token',
])
const SECRET_KEYS = new Set(['email.api_key', 'cloudflare.api_token'])

const DEFAULTS = {
  'site.name': 'Friends of the Stokes Shelter',
  'site.tagline': 'A safe haven for pets, and the people who love them.',
  'site.logo_url': '/api/logo',
  'header.cta_label': 'Meet our pets',
  'header.cta_url': '/adopt/all/',
  'header.announcement': '',
  'header.show_announcement': 'false',
  'footer.contact_email': 'friendsofthestokesshelter@gmail.com',
  'email.provider': 'resend',
  'email.from_name': 'Friends of the Stokes Shelter',
  'email.from_address': '',
  'email.reply_to': '',
  'email.api_key': '',
  'cloudflare.account_id': '',
  'cloudflare.zone_id': '',
  'cloudflare.api_token': '',
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     sub TEXT UNIQUE,
     email TEXT,
     name TEXT,
     picture TEXT,
     role TEXT NOT NULL CHECK (role IN ('owner','admin','editor')),
     status TEXT NOT NULL DEFAULT 'active',
     created_at TEXT NOT NULL,
     last_seen_at TEXT
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS users_email ON users (lower(email))`,
  `CREATE TABLE IF NOT EXISTS invites (
     email TEXT PRIMARY KEY,
     role TEXT NOT NULL CHECK (role IN ('admin','editor')),
     invited_by TEXT,
     created_at TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS settings (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     updated_by TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS assets (
     id TEXT PRIMARY KEY,
     type TEXT NOT NULL,
     bytes BLOB NOT NULL,
     created_at TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS audit (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     at TEXT NOT NULL,
     actor TEXT,
     action TEXT NOT NULL,
     detail TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS sessions (
     token_hash TEXT PRIMARY KEY,
     user_id INTEGER NOT NULL,
     created_at TEXT NOT NULL,
     expires_at TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS login_codes (
     email TEXT PRIMARY KEY,
     purpose TEXT NOT NULL,
     code_hash TEXT NOT NULL,
     expires_at TEXT NOT NULL,
     tries INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS auth_failures (
     key TEXT PRIMARY KEY,
     count INTEGER NOT NULL,
     first_at TEXT NOT NULL
   )`,
]

let schemaReady
async function ensureSchema(env) {
  schemaReady ??= (async () => {
    for (const sql of SCHEMA) await env.DB.prepare(sql).run()

    // Older rows predate this app's own passwords.
    const columns = await env.DB.prepare('PRAGMA table_info(users)').all()
    const names = new Set((columns.results ?? []).map((column) => column.name))
    for (const column of ['password_hash', 'password_updated_at']) {
      if (!names.has(column)) await env.DB.prepare(`ALTER TABLE users ADD COLUMN ${column} TEXT`).run()
    }

    const now = new Date().toISOString()
    for (const ownerEmail of BOOTSTRAP_OWNER_EMAILS) {
      await env.DB.prepare(
        'INSERT OR IGNORE INTO invites (email, role, invited_by, created_at) VALUES (?, ?, ?, ?)'
      ).bind(ownerEmail, 'admin', 'setup', now).run()
    }
    await env.DB.prepare(
      `INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO NOTHING`
    ).bind('bootstrap.owner', BOOTSTRAP_OWNER_EMAILS.join(','), now, 'setup').run()

    // Access follows the list above: an address the list no longer names loses
    // the invitation and owner account it was seeded with.
    const owners = BOOTSTRAP_OWNER_EMAILS.map((email) => email.trim().toLowerCase())
    const marks = owners.map(() => '?').join(', ')
    await env.DB.prepare(
      `DELETE FROM invites WHERE invited_by = 'setup' AND lower(email) NOT IN (${marks})`
    ).bind(...owners).run()
    await env.DB.prepare(
      `DELETE FROM users WHERE role = 'owner' AND lower(email) NOT IN (${marks})`
    ).bind(...owners).run()
  })().catch((err) => {
    schemaReady = undefined
    throw err
  })
  return schemaReady
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (url.pathname.startsWith('/api/')) {
      await ensureSchema(env)
      try {
        return await handleApi(request, env, url)
      } catch (err) {
        console.error('api error', url.pathname, err && err.stack ? err.stack : String(err))
        return json({ error: 'Something went wrong on our side.' }, 500)
      }
    }

    return env.ASSETS.fetch(request)
  },
}

/* ------------------------------------------------------------------ helpers */

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'private, no-store',
      ...extra,
    },
  })
}

function corsHeaders(origin) {
  const allow = PUBLIC_SITE_ORIGINS.has(origin) ? origin : '*'
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Max-Age': '600',
  }
}

async function readSettings(db) {
  const rows = await db.prepare('SELECT key, value FROM settings').all()
  const out = { ...DEFAULTS }
  for (const row of rows.results ?? []) {
    if (row.key === 'bootstrap.owner') continue
    if (Object.prototype.hasOwnProperty.call(DEFAULTS, row.key)) out[row.key] = row.value
  }
  return out
}

function redact(settings, role) {
  const out = {}
  for (const [key, value] of Object.entries(settings)) {
    if (SECRET_KEYS.has(key)) {
      out[key] = value ? `••••${String(value).slice(-4)}` : ''
      out[`${key}__set`] = Boolean(value)
    } else {
      out[key] = value
    }
  }
  return out
}

async function audit(db, actor, action, detail) {
  await db
    .prepare('INSERT INTO audit (at, actor, action, detail) VALUES (?, ?, ?, ?)')
    .bind(new Date().toISOString(), actor ?? 'system', action, detail ?? null)
    .run()
}

/* ------------------------------------------------------- passwords & sessions */

const encoder = new TextEncoder()

function bytesToBase64(bytes) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64ToBytes(text) {
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0))
}

function randomToken() {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(32)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

// 120k rounds of PBKDF2-SHA256, stored as pbkdf2$rounds$salt$hash.
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 120000, hash: 'SHA-256' }, key, 256)
  return `pbkdf2$120000$${bytesToBase64(salt)}$${bytesToBase64(new Uint8Array(bits))}`
}

function safeEqual(left, right) {
  if (left.length !== right.length) return false
  let diff = 0
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i)
  return diff === 0
}

async function checkPassword(password, stored) {
  const parts = String(stored ?? '').split('$')
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false
  const rounds = Number(parts[1])
  if (!Number.isFinite(rounds) || rounds < 1000) return false
  const salt = base64ToBytes(parts[2])
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: rounds, hash: 'SHA-256' }, key, 256)
  return safeEqual(bytesToBase64(new Uint8Array(bits)), parts[3])
}

// A page served with `Referrer-Policy: no-referrer` posts `Origin: null` even to
// itself; `Sec-Fetch-Site` is browser-set and cannot be forged by page script.
function isSameOriginRequest(request, origin) {
  const header = request.headers.get('origin')
  if (header && header !== 'null') return header === origin
  return request.headers.get('sec-fetch-site') === 'same-origin'
}

/** Ambiguous (duplicated) cookies read as absent: fail closed. */
function readCookie(request, name) {
  const found = (request.headers.get('cookie') ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`))
  if (found.length !== 1) return null
  const value = found[0].slice(name.length + 1)
  return value && value.length <= 4000 ? value : null
}

function sessionCookie(request, token, maxAgeSeconds) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : ''
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`
}

async function startSession(env, request, userId) {
  const token = randomToken()
  const now = new Date()
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now.toISOString()).run()
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * 86400000).toISOString()
  await env.DB.prepare(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
  )
    .bind(await sha256Hex(token), userId, now.toISOString(), expiresAt)
    .run()
  return sessionCookie(request, token, SESSION_DAYS * 86400)
}

// Who is asking, from the session cookie this app issued.
async function currentStaff(env, request) {
  const token = readCookie(request, SESSION_COOKIE)
  if (!token) return { staff: null, member: false }
  const row = await env.DB.prepare(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`
  )
    .bind(await sha256Hex(token), new Date().toISOString())
    .first()
  if (!row || row.status !== 'active') return { staff: null, member: false }
  return { staff: row, member: true }
}

/* ------------------------------------------------------------ emailed codes */

function emailConnected(settings) {
  return Boolean(settings['email.api_key'] && settings['email.from_address'])
}

async function sendMail(settings, { to, subject, text }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${settings['email.api_key']}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: `${settings['email.from_name'] || 'Friends of the Stokes Shelter'} <${settings['email.from_address']}>`,
      to: [to],
      reply_to: settings['email.reply_to'] || undefined,
      subject,
      text,
    }),
  })
  if (!res.ok) return { ok: false, detail: (await res.text().catch(() => '')).slice(0, 300) }
  return { ok: true }
}

function codeHash(email, purpose, code) {
  return sha256Hex(`${email}|${purpose}|${code}`)
}

async function issueCode(env, settings, email, purpose) {
  const code = String(Math.floor(Math.random() * 1000000)).padStart(6, '0')
  const now = new Date()
  await env.DB.prepare(
    `INSERT INTO login_codes (email, purpose, code_hash, expires_at, tries, created_at) VALUES (?, ?, ?, ?, 0, ?)
     ON CONFLICT(email) DO UPDATE SET purpose = excluded.purpose, code_hash = excluded.code_hash,
       expires_at = excluded.expires_at, tries = 0, created_at = excluded.created_at`
  )
    .bind(email, purpose, await codeHash(email, purpose, code), new Date(now.getTime() + CODE_MINUTES * 60000).toISOString(), now.toISOString())
    .run()
  const sent = await sendMail(settings, {
    to: email,
    subject: `Your sign-in code: ${code}`,
    text: `Your Friends of the Stokes Shelter sign-in code is ${code}.\n\nIt works once and expires in ${CODE_MINUTES} minutes. If you did not ask for it, you can ignore this email.`,
  })
  if (!sent.ok) {
    await env.DB.prepare('DELETE FROM login_codes WHERE email = ?').bind(email).run()
    return { ok: false, error: 'The email service would not send the code.', detail: sent.detail }
  }
  return { ok: true }
}

async function checkCode(env, email, purpose, code) {
  const row = await env.DB.prepare('SELECT * FROM login_codes WHERE email = ?').bind(email).first()
  if (!row || row.purpose !== purpose) return { ok: false, error: 'That code has expired. Ask for a new one.' }
  if (row.expires_at <= new Date().toISOString()) {
    await env.DB.prepare('DELETE FROM login_codes WHERE email = ?').bind(email).run()
    return { ok: false, error: 'That code has expired. Ask for a new one.' }
  }
  if (row.tries >= CODE_TRIES) {
    await env.DB.prepare('DELETE FROM login_codes WHERE email = ?').bind(email).run()
    return { ok: false, error: 'Too many tries with that code. Ask for a new one.' }
  }
  if (!safeEqual(await codeHash(email, purpose, code), row.code_hash)) {
    await env.DB.prepare('UPDATE login_codes SET tries = tries + 1 WHERE email = ?').bind(email).run()
    return { ok: false, error: 'That code is not right.' }
  }
  await env.DB.prepare('DELETE FROM login_codes WHERE email = ?').bind(email).run()
  return { ok: true }
}

async function tooManyFailures(db, key) {
  const row = await db.prepare('SELECT count, first_at FROM auth_failures WHERE key = ?').bind(key).first()
  if (!row) return false
  const windowStart = new Date(Date.now() - FAILURE_WINDOW_MINUTES * 60000).toISOString()
  return row.first_at >= windowStart && row.count >= MAX_FAILURES
}

async function noteFailure(db, key) {
  const now = new Date()
  const windowStart = new Date(now.getTime() - FAILURE_WINDOW_MINUTES * 60000).toISOString()
  const row = await db.prepare('SELECT first_at FROM auth_failures WHERE key = ?').bind(key).first()
  if (!row || row.first_at < windowStart) {
    await db
      .prepare(
        `INSERT INTO auth_failures (key, count, first_at) VALUES (?, 1, ?)
         ON CONFLICT(key) DO UPDATE SET count = 1, first_at = excluded.first_at`
      )
      .bind(key, now.toISOString())
      .run()
    return
  }
  await db.prepare('UPDATE auth_failures SET count = count + 1 WHERE key = ?').bind(key).run()
}

async function clearFailures(db, key) {
  await db.prepare('DELETE FROM auth_failures WHERE key = ?').bind(key).run()
}

// Staff access is keyed by email: an account exists only because an owner
// invited that address (or because it starts the place).
async function staffFor(db, email) {
  const user = await db.prepare('SELECT * FROM users WHERE lower(email) = ?').bind(email).first()
  if (user) return { user, invite: null }
  const invite = await db.prepare('SELECT * FROM invites WHERE lower(email) = ?').bind(email).first()
  return { user: null, invite }
}

function can(role) {
  return {
    editSite: role === 'owner' || role === 'admin' || role === 'editor',
    editSettings: role === 'owner' || role === 'admin',
    manageStaff: role === 'owner' || role === 'admin',
    owner: role === 'owner',
  }
}

/* ---------------------------------------------------------------------- API */

async function handleApi(request, env, url) {
  const path = url.pathname
  const method = request.method
  const db = env.DB

  // Public: the static site asks for its header/name/logo from here.
  if (path === '/api/public-config') {
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin') ?? '') })
    const settings = await readSettings(db)
    const body = {
      siteName: settings['site.name'],
      tagline: settings['site.tagline'],
      logoUrl: settings['site.logo_url'],
      ctaLabel: settings['header.cta_label'],
      ctaUrl: settings['header.cta_url'],
      announcement: settings['header.show_announcement'] === 'true' ? settings['header.announcement'] : '',
      contactEmail: settings['footer.contact_email'],
    }
    return json(body, 200, {
      'cache-control': 'public, max-age=60',
      ...corsHeaders(request.headers.get('origin') ?? ''),
    })
  }

  // Public: uploaded logo bytes. Reads only — uploading the logo happens below,
  // behind the staff check.
  if (path.startsWith('/api/logo') && (method === 'GET' || method === 'HEAD')) {
    const row = await db.prepare('SELECT type, bytes FROM assets ORDER BY created_at DESC LIMIT 1').first()
    if (!row) return new Response(null, { status: 404 })
    return new Response(row.bytes, {
      headers: { 'content-type': row.type, 'cache-control': 'public, max-age=300' },
    })
  }

  if (path === '/api/health') return json({ ok: true })

  /* ------------------------------------------------------------------ sign in */

  // Public: lets the sign-in screen say whether emailed codes are on yet.
  if (path === '/api/auth/state' && method === 'GET') {
    const settings = await readSettings(db)
    return json({ emailConnected: emailConnected(settings) })
  }

  if (path === '/api/auth/login' && method === 'POST') {
    if (!isSameOriginRequest(request, env.APP_ORIGIN)) return json({ error: 'Cross-site request refused.' }, 403)
    const body = await request.json().catch(() => null)
    const email = String(body?.email ?? '').trim().toLowerCase()
    const password = String(body?.password ?? '')
    if (!email || !password) return json({ error: 'Enter your email and password.' }, 400)
    if (await tooManyFailures(db, `login:${email}`)) {
      return json({ error: `Too many tries. Wait ${FAILURE_WINDOW_MINUTES} minutes and try again.` }, 429)
    }

    const { user, invite } = await staffFor(db, email)
    if (!user && !invite) {
      await audit(db, email, 'auth.no_access', 'not on the staff list')
      return json({ error: 'That email is not on the staff list. Ask an owner to add you.' }, 401)
    }
    if (user && user.status !== 'active') {
      return json({ error: 'This account is paused. Ask an owner.' }, 403)
    }
    if (!user || !user.password_hash) {
      // First visit for this address: they choose a password (with a code when
      // email is connected), so there is nothing to compare yet.
      return json({ step: 'setup', email })
    }
    if (!(await checkPassword(password, user.password_hash))) {
      await noteFailure(db, `login:${email}`)
      await audit(db, email, 'auth.failed', 'wrong password')
      return json({ error: 'That password is not right.' }, 401)
    }
    await clearFailures(db, `login:${email}`)

    const settings = await readSettings(db)
    if (!emailConnected(settings)) {
      // No way to deliver a code yet: password only, and the screen says so.
      const cookie = await startSession(env, request, user.id)
      await db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').bind(new Date().toISOString(), user.id).run()
      await audit(db, email, 'auth.sign_in', 'password only, email not connected')
      return json({ step: 'done', emailConnected: false }, 200, { 'set-cookie': cookie })
    }
    const issued = await issueCode(env, settings, email, 'login')
    if (!issued.ok) return json({ error: issued.error, detail: issued.detail }, 400)
    await audit(db, email, 'auth.code_sent', 'sign-in')
    return json({ step: 'code', email })
  }

  // Sends a code for a first password or a forgotten one.
  if (path === '/api/auth/start' && method === 'POST') {
    if (!isSameOriginRequest(request, env.APP_ORIGIN)) return json({ error: 'Cross-site request refused.' }, 403)
    const body = await request.json().catch(() => null)
    const email = String(body?.email ?? '').trim().toLowerCase()
    if (!email) return json({ error: 'Enter your email first.' }, 400)
    const { user, invite } = await staffFor(db, email)
    if (!user && !invite) return json({ error: 'That email is not on the staff list. Ask an owner to add you.' }, 401)
    if (user && user.status !== 'active') return json({ error: 'This account is paused. Ask an owner.' }, 403)
    const settings = await readSettings(db)
    if (!emailConnected(settings)) {
      return json({ error: 'Email is not connected yet, so no code can be sent. Ask an owner to connect it in the staff area.' }, 400)
    }
    const purpose = user && user.password_hash ? 'reset' : 'setup'
    const issued = await issueCode(env, settings, email, purpose)
    if (!issued.ok) return json({ error: issued.error, detail: issued.detail }, 400)
    await audit(db, email, 'auth.code_sent', purpose)
    return json({ ok: true, purpose })
  }

  if (path === '/api/auth/set-password' && method === 'POST') {
    if (!isSameOriginRequest(request, env.APP_ORIGIN)) return json({ error: 'Cross-site request refused.' }, 403)
    const body = await request.json().catch(() => null)
    const email = String(body?.email ?? '').trim().toLowerCase()
    const password = String(body?.password ?? '')
    const code = String(body?.code ?? '').trim()
    if (password.length < MIN_PASSWORD) return json({ error: `Use at least ${MIN_PASSWORD} characters for the password.` }, 400)

    const { user, invite } = await staffFor(db, email)
    if (!user && !invite) return json({ error: 'That email is not on the staff list. Ask an owner to add you.' }, 401)
    if (user && user.status !== 'active') return json({ error: 'This account is paused. Ask an owner.' }, 403)

    const settings = await readSettings(db)
    const withCode = emailConnected(settings)
    const purpose = user && user.password_hash ? 'reset' : 'setup'
    if (withCode) {
      if (!code) return json({ error: 'Enter the code from your email.' }, 400)
      const checked = await checkCode(env, email, purpose, code)
      if (!checked.ok) return json({ error: checked.error }, 401)
    }

    const now = new Date().toISOString()
    const hash = await hashPassword(password)
    let accountId = user?.id
    if (!accountId) {
      const role = BOOTSTRAP_OWNER_EMAILS.includes(email) ? 'owner' : invite.role
      await db
        .prepare(
          `INSERT INTO users (sub, email, name, picture, role, status, created_at, last_seen_at, password_hash, password_updated_at)
           VALUES (NULL, ?, NULL, NULL, ?, 'active', ?, ?, ?, ?)`
        )
        .bind(email, role, now, now, hash, now)
        .run()
      const created = await db.prepare('SELECT id FROM users WHERE lower(email) = ?').bind(email).first()
      accountId = created.id
      await db.prepare('DELETE FROM invites WHERE lower(email) = ?').bind(email).run()
      await audit(db, email, 'staff.first_sign_in', `role=${role}${withCode ? ', email code' : ', email not connected'}`)
    } else {
      await db
        .prepare('UPDATE users SET password_hash = ?, password_updated_at = ?, last_seen_at = ? WHERE id = ?')
        .bind(hash, now, now, accountId)
        .run()
      await db.prepare('DELETE FROM invites WHERE lower(email) = ?').bind(email).run()
      await audit(db, email, user.password_hash ? 'auth.password_reset' : 'auth.password_set', withCode ? 'email code' : 'email not connected')
    }

    // The bootstrap owners always run the place, whatever invited them.
    if (BOOTSTRAP_OWNER_EMAILS.includes(email)) {
      await db.prepare("UPDATE users SET role = 'owner' WHERE id = ?").bind(accountId).run()
    }

    const cookie = await startSession(env, request, accountId)
    return json({ ok: true }, 200, { 'set-cookie': cookie })
  }

  if (path === '/api/auth/verify' && method === 'POST') {
    if (!isSameOriginRequest(request, env.APP_ORIGIN)) return json({ error: 'Cross-site request refused.' }, 403)
    const body = await request.json().catch(() => null)
    const email = String(body?.email ?? '').trim().toLowerCase()
    const code = String(body?.code ?? '').trim()
    if (!email || !code) return json({ error: 'Enter the code from your email.' }, 400)
    if (await tooManyFailures(db, `code:${email}`)) {
      return json({ error: `Too many tries. Wait ${FAILURE_WINDOW_MINUTES} minutes and try again.` }, 429)
    }
    const { user } = await staffFor(db, email)
    if (!user || user.status !== 'active' || !user.password_hash) {
      return json({ error: 'Sign in with your email and password first.' }, 401)
    }
    const checked = await checkCode(env, email, 'login', code)
    if (!checked.ok) {
      await noteFailure(db, `code:${email}`)
      return json({ error: checked.error }, 401)
    }
    await clearFailures(db, `code:${email}`)
    const cookie = await startSession(env, request, user.id)
    await db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').bind(new Date().toISOString(), user.id).run()
    await audit(db, email, 'auth.sign_in', 'password + email code')
    return json({ ok: true }, 200, { 'set-cookie': cookie })
  }

  if (path === '/api/auth/logout' && method === 'POST') {
    if (!isSameOriginRequest(request, env.APP_ORIGIN)) return json({ error: 'Cross-site request refused.' }, 403)
    const token = readCookie(request, SESSION_COOKIE)
    if (token) await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run()
    return json({ ok: true }, 200, { 'set-cookie': sessionCookie(request, '', 0) })
  }

  const me = await currentStaff(env, request)

  if (path === '/api/me') {
    return json({
      signedIn: me.member,
      user: me.staff
        ? { email: me.staff.email ?? null, name: me.staff.name ?? null, picture: me.staff.picture ?? null }
        : null,
      member: me.member,
      role: me.staff?.role ?? null,
      permissions: me.member ? can(me.staff.role) : null,
    })
  }

  if (!me.member) {
    return json({ error: 'Staff access required.', signedIn: false }, 401)
  }

  const perms = can(me.staff.role)

  if (method !== 'GET' && !isSameOriginRequest(request, env.APP_ORIGIN)) {
    return json({ error: 'Cross-site request refused.' }, 403)
  }

  if (path === '/api/settings' && method === 'GET') {
    const settings = await readSettings(db)
    return json({ settings: redact(settings, me.staff.role), role: me.staff.role, permissions: perms })
  }

  if (path === '/api/settings' && method === 'PUT') {
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return json({ error: 'Expected a JSON object.' }, 400)
    const changed = []
    const now = new Date().toISOString()
    for (const [key, raw] of Object.entries(body)) {
      if (!ADMIN_KEYS.has(key)) continue
      if (!perms.editSettings && !EDITOR_KEYS.has(key)) continue
      const value = raw === null || raw === undefined ? '' : String(raw)
      if (SECRET_KEYS.has(key) && value.startsWith('••••')) continue
      if (value.length > 4000) return json({ error: `${key} is too long.` }, 400)
      await db
        .prepare(
          `INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
        )
        .bind(key, value, now, me.staff.email ?? me.staff.sub)
        .run()
      changed.push(key)
    }
    if (changed.length) await audit(db, me.staff.email, 'settings.update', changed.join(', '))
    const settings = await readSettings(db)
    return json({ ok: true, changed, settings: redact(settings, me.staff.role) })
  }

  if (path === '/api/logo' && method === 'POST') {
    if (!perms.editSettings) return json({ error: 'Only admins can change the logo.' }, 403)
    const form = await request.formData().catch(() => null)
    const file = form?.get('logo')
    if (!(file instanceof File)) return json({ error: 'Choose an image file.' }, 400)
    if (!/^image\/(png|jpeg|webp|svg\+xml|gif)$/.test(file.type)) {
      return json({ error: 'Use a PNG, JPG, GIF, WebP or SVG image.' }, 400)
    }
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (bytes.byteLength > 400 * 1024) return json({ error: 'That image is too big — keep it under 400 KB.' }, 400)
    const id = crypto.randomUUID()
    await db.prepare('DELETE FROM assets').run()
    await db
      .prepare('INSERT INTO assets (id, type, bytes, created_at) VALUES (?, ?, ?, ?)')
      .bind(id, file.type, bytes, new Date().toISOString())
      .run()
    await db
      .prepare(
        `INSERT INTO settings (key, value, updated_at, updated_by) VALUES ('site.logo_url', '/api/logo', ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .bind(new Date().toISOString(), me.staff.email)
      .run()
    await audit(db, me.staff.email, 'logo.upload', `${file.type} ${bytes.byteLength} bytes`)
    return json({ ok: true, logoUrl: '/api/logo' })
  }

  if (path === '/api/staff' && method === 'GET') {
    if (!perms.manageStaff) return json({ error: 'Only admins can see staff.' }, 403)
    const users = await db.prepare('SELECT id, email, name, role, status, created_at, last_seen_at FROM users ORDER BY created_at').all()
    const invites = await db.prepare('SELECT email, role, created_at FROM invites ORDER BY created_at').all()
    return json({ users: users.results ?? [], invites: invites.results ?? [], role: me.staff.role })
  }

  if (path === '/api/staff' && method === 'POST') {
    if (!perms.manageStaff) return json({ error: 'Only admins can add staff.' }, 403)
    const body = await request.json().catch(() => null)
    const email = String(body?.email ?? '').trim().toLowerCase()
    const role = String(body?.role ?? 'editor')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'That email address does not look right.' }, 400)
    if (role !== 'admin' && role !== 'editor') return json({ error: 'Pick admin or editor.' }, 400)
    if (role === 'admin' && !perms.owner && me.staff.role !== 'admin') return json({ error: 'Not allowed.' }, 403)
    const existing = await db.prepare('SELECT id, role FROM users WHERE lower(email) = ?').bind(email).first()
    if (existing) return json({ error: 'That person is already staff.' }, 409)
    await db
      .prepare('INSERT INTO invites (email, role, invited_by, created_at) VALUES (?, ?, ?, ?)')
      .bind(email, role, me.staff.email, new Date().toISOString())
      .run()
    await audit(db, me.staff.email, 'staff.invite', `${email} as ${role}`)
    return json({ ok: true })
  }

  const staffMatch = path.match(/^\/api\/staff\/(\d+)$/)
  if (staffMatch && method === 'PATCH') {
    if (!perms.manageStaff) return json({ error: 'Only admins can change staff.' }, 403)
    const id = Number(staffMatch[1])
    const target = await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first()
    if (!target) return json({ error: 'No such staff member.' }, 404)
    if (target.role === 'owner') return json({ error: 'The owner account cannot be changed here.' }, 403)
    if (target.role === 'admin' && !perms.owner) return json({ error: 'Only the owner can change admins.' }, 403)
    const body = await request.json().catch(() => ({}))
    const role = body?.role ?? target.role
    const status = body?.status ?? target.status
    if (!ROLES.includes(role)) return json({ error: 'Unknown role.' }, 400)
    if (status !== 'active' && status !== 'suspended') return json({ error: 'Unknown status.' }, 400)
    await db.prepare('UPDATE users SET role = ?, status = ? WHERE id = ?').bind(role, status, id).run()
    await audit(db, me.staff.email, 'staff.update', `#${id} role=${role} status=${status}`)
    return json({ ok: true })
  }

  if (staffMatch && method === 'DELETE') {
    if (!perms.manageStaff) return json({ error: 'Only admins can remove staff.' }, 403)
    const id = Number(staffMatch[1])
    const target = await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first()
    if (!target) return json({ error: 'No such staff member.' }, 404)
    if (target.role === 'owner') return json({ error: 'The owner account cannot be removed.' }, 403)
    if (target.role === 'admin' && !perms.owner) return json({ error: 'Only the owner can remove admins.' }, 403)
    await db.prepare('DELETE FROM users WHERE id = ?').bind(id).run()
    await audit(db, me.staff.email, 'staff.remove', `#${id} ${target.email}`)
    return json({ ok: true })
  }

  const inviteMatch = path.match(/^\/api\/invites\/(.+)$/)
  if (inviteMatch && method === 'DELETE') {
    if (!perms.manageStaff) return json({ error: 'Only admins can cancel invites.' }, 403)
    const email = decodeURIComponent(inviteMatch[1])
    if (BOOTSTRAP_OWNER_EMAILS.includes(email.trim().toLowerCase())) return json({ error: 'That invitation starts an owner account.' }, 403)
    await db.prepare('DELETE FROM invites WHERE lower(email) = lower(?)').bind(email).run()
    await audit(db, me.staff.email, 'staff.invite_cancel', email)
    return json({ ok: true })
  }

  if (path === '/api/email/test' && method === 'POST') {
    if (!perms.editSettings) return json({ error: 'Only admins can test email.' }, 403)
    const settings = await readSettings(db)
    if (!settings['email.api_key']) return json({ error: 'Add an email API key first.' }, 400)
    if (!settings['email.from_address']) return json({ error: 'Add a "from" address first.' }, 400)
    const to = me.staff.email
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${settings['email.api_key']}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: `${settings['email.from_name']} <${settings['email.from_address']}>`,
        to: [to],
        reply_to: settings['email.reply_to'] || undefined,
        subject: 'Test message from your shelter site',
        text: 'This is a test. If you can read this, the site can send email.',
      }),
    })
    const detail = await res.text()
    await audit(db, me.staff.email, 'email.test', `status=${res.status}`)
    if (!res.ok) return json({ error: 'The email service refused the message.', detail: detail.slice(0, 500) }, 400)
    return json({ ok: true, sentTo: to })
  }

  if (path === '/api/cloudflare/check' && method === 'POST') {
    if (!perms.editSettings) return json({ error: 'Only admins can check Cloudflare.' }, 403)
    const settings = await readSettings(db)
    if (!settings['cloudflare.api_token']) return json({ error: 'Add a Cloudflare API token first.' }, 400)
    const token = settings['cloudflare.api_token']
    const verify = await fetch('https://api.cloudflare.com/client/v4/user/tokens/verify', {
      headers: { authorization: `Bearer ${token}` },
    })
    const verifyBody = await verify.json().catch(() => ({}))
    if (!verify.ok || verifyBody?.success === false) {
      return json({ error: 'Cloudflare did not accept that token.', detail: verifyBody?.errors ?? null }, 400)
    }
    let zone = null
    if (settings['cloudflare.zone_id']) {
      const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${settings['cloudflare.zone_id']}`, {
        headers: { authorization: `Bearer ${token}` },
      })
      const body = await res.json().catch(() => ({}))
      if (res.ok && body?.success) zone = { name: body.result.name, status: body.result.status }
    }
    await audit(db, me.staff.email, 'cloudflare.check', zone ? zone.name : 'token only')
    return json({ ok: true, token: verifyBody?.result?.status ?? 'active', zone })
  }

  if (path === '/api/audit' && method === 'GET') {
    if (!perms.owner) return json({ error: 'Owner only.' }, 403)
    const rows = await db.prepare('SELECT at, actor, action, detail FROM audit ORDER BY id DESC LIMIT 100').all()
    return json({ entries: rows.results ?? [] })
  }

  return json({ error: 'Not found.' }, 404)
}
