import { createFreebuffAuth, isSameOriginRequest } from '@freebuff/auth'

// Who runs the place on day one. They are created as owner the first time they
// sign in with this exact email address.
const BOOTSTRAP_OWNER_EMAILS = ['dannyrcollinsjr@gmail.com', 'irishboiblu@gmail.com']

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
]

let schemaReady
async function ensureSchema(env) {
  schemaReady ??= (async () => {
    for (const sql of SCHEMA) await env.DB.prepare(sql).run()
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
  })().catch((err) => {
    schemaReady = undefined
    throw err
  })
  return schemaReady
}

let authInstance
let appHandler

function buildApp(env) {
  const loopback = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(env.APP_ORIGIN || '')
  authInstance ??= createFreebuffAuth({
    clientId: env.FREEBUFF_CLIENT_ID,
    issuer: env.FREEBUFF_ISSUER,
    baseUrl: env.APP_ORIGIN,
    // Only ever relaxed for a loopback development origin.
    ...(loopback ? { allowInsecureLocalhost: true } : {}),
  })
  const auth = authInstance

  appHandler ??= auth.wrap(async (request, env2) => {
    const url = new URL(request.url)
    const path = url.pathname

    if (path.startsWith('/api/')) {
      await ensureSchema(env2)
      try {
        return await handleApi(request, env2, auth, url)
      } catch (err) {
        console.error('api error', path, err && err.stack ? err.stack : String(err))
        return json({ error: 'Something went wrong on our side.' }, 500)
      }
    }

    return env2.ASSETS.fetch(request)
  })
  return appHandler
}

export default {
  fetch(request, env) {
    return buildApp(env)(request, env)
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

// Resolves the signed-in person to a staff row. Signing in is not the same as
// being staff: an account only gets a role from the invite list.
async function currentStaff(env, auth, request) {
  const user = await auth.getUser(request)
  if (!user) return { user: null, staff: null, member: false }

  const db = env.DB
  let row = await db.prepare('SELECT * FROM users WHERE sub = ?').bind(user.sub).first()

  if (!row && user.email) {
    const invite = await db
      .prepare('SELECT * FROM invites WHERE lower(email) = lower(?)')
      .bind(user.email)
      .first()
    if (invite) {
      const now = new Date().toISOString()
      await db
        .prepare(
          `INSERT INTO users (sub, email, name, picture, role, status, created_at, last_seen_at)
           VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
           ON CONFLICT(sub) DO UPDATE SET last_seen_at = excluded.last_seen_at`
        )
        .bind(user.sub, user.email, user.name ?? null, user.picture ?? null, invite.role, now, now)
        .run()
      await db.prepare('DELETE FROM invites WHERE email = ?').bind(invite.email).run()
      if (BOOTSTRAP_OWNER_EMAILS.includes(String(invite.email).trim().toLowerCase())) {
        await db.prepare("UPDATE users SET role = 'owner' WHERE sub = ?").bind(user.sub).run()
      }
      await audit(db, user.email, 'staff.first_sign_in', `role=${invite.role} email_verified=${user.email_verified}`)
      row = await db.prepare('SELECT * FROM users WHERE sub = ?').bind(user.sub).first()
    }
  }

  if (row && row.status === 'active') {
    await db
      .prepare('UPDATE users SET last_seen_at = ?, name = COALESCE(?, name), picture = COALESCE(?, picture) WHERE sub = ?')
      .bind(new Date().toISOString(), user.name ?? null, user.picture ?? null, user.sub)
      .run()
  }

  return {
    user,
    staff: row && row.status === 'active' ? row : null,
    member: Boolean(row && row.status === 'active'),
  }
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

async function handleApi(request, env, auth, url) {
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

  // Public: uploaded logo bytes.
  if (path.startsWith('/api/logo')) {
    const row = await db.prepare('SELECT type, bytes FROM assets ORDER BY created_at DESC LIMIT 1').first()
    if (!row) return new Response(null, { status: 404 })
    return new Response(row.bytes, {
      headers: { 'content-type': row.type, 'cache-control': 'public, max-age=300' },
    })
  }

  if (path === '/api/health') return json({ ok: true })

  const me = await currentStaff(env, auth, request)

  if (path === '/api/me') {
    return json({
      signedIn: Boolean(me.user),
      user: me.user
        ? { email: me.user.email ?? null, name: me.user.name ?? null, picture: me.user.picture ?? null }
        : null,
      member: me.member,
      role: me.staff?.role ?? null,
      permissions: me.member ? can(me.staff.role) : null,
    })
  }

  if (!me.member) {
    return json({ error: 'Staff access required.', signedIn: Boolean(me.user) }, 401)
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
