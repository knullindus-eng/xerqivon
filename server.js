import { createServer } from "node:http";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const PROJECT_ROOT = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC_ROOT = fileURLToPath(new URL("./public/", import.meta.url));
const env = {
  ...loadEnv(join(PROJECT_ROOT, ".env")),
  ...process.env,
};
const PORT = Number(env.PORT || 3000);
const ADMIN_PASSWORD = env.ADMIN_PASSWORD;
const DATABASE_URL = env.NEON_DATABASE_URL || env.NEON_DATABASE_URL_UNPOOLED;
const SESSION_COOKIE = "knull_admin_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const sessions = new Map();
const VALID_TABLES = new Set(["apps", "mail_accounts"]);
const IS_PRODUCTION = env.NODE_ENV === "production";
const LOGIN_WINDOW_MS = 1000 * 60 * 15;
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCK_MS = 1000 * 60 * 15;
const loginAttempts = new Map();
const DATABASE_STATUS_TTL_MS = 1000 * 10;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
};

const pool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    })
  : null;

let dbConnected = false;
let schemaReady = false;
let lastDatabaseCheckAt = 0;
let databaseRefreshInFlight = null;

function loadEnv(path) {
  if (!existsSync(path)) return {};
  const text = readFileSync(path, "utf8");
  const values = {};

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separator = line.indexOf("=");
    if (separator === -1) continue;

    values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }

  return values;
}

function json(res, statusCode, payload, headers = {}) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    ...headers,
  });
  res.end(JSON.stringify(payload));
}

function notFound(res) {
  json(res, 404, { error: "not found" });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";

    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error("payload too large"));
      }
    });

    req.on("end", () => {
      if (!data) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error("invalid json body"));
      }
    });

    req.on("error", reject);
  });
}

function parseCookies(req) {
  const cookieHeader = req.headers.cookie || "";
  const cookies = {};

  for (const item of cookieHeader.split(";")) {
    const [key, ...rest] = item.trim().split("=");
    if (!key) continue;
    cookies[key] = decodeURIComponent(rest.join("="));
  }

  return cookies;
}

function getSession(req) {
  cleanupSessions();
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;

  const session = sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }

  return { token, ...session };
}

function cleanupSessions() {
  const now = Date.now();
  for (const [token, session] of sessions.entries()) {
    if (session.expiresAt < now) sessions.delete(token);
  }
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }

  return req.socket.remoteAddress || "unknown";
}

function getLoginState(ip) {
  const now = Date.now();
  const current = loginAttempts.get(ip);
  if (!current) return { count: 0, windowStartedAt: now, lockedUntil: 0 };

  if (current.lockedUntil && current.lockedUntil > now) {
    return current;
  }

  if (now - current.windowStartedAt > LOGIN_WINDOW_MS) {
    const reset = { count: 0, windowStartedAt: now, lockedUntil: 0 };
    loginAttempts.set(ip, reset);
    return reset;
  }

  return current;
}

function recordFailedLogin(ip) {
  const now = Date.now();
  const current = getLoginState(ip);
  const nextCount = current.count + 1;
  const nextState = {
    count: nextCount,
    windowStartedAt: current.windowStartedAt || now,
    lockedUntil: nextCount >= LOGIN_MAX_ATTEMPTS ? now + LOGIN_LOCK_MS : 0,
  };

  loginAttempts.set(ip, nextState);
  return nextState;
}

function clearLoginAttempts(ip) {
  loginAttempts.delete(ip);
}

function createSession() {
  const token = crypto.randomBytes(24).toString("hex");
  sessions.set(token, {
    isAdmin: true,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  return token;
}

function sessionCookie(token, clear = false) {
  const securePart = IS_PRODUCTION ? "; Secure" : "";

  if (clear) {
    return `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${securePart}`;
  }

  return `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; Max-Age=${Math.floor(
    SESSION_TTL_MS / 1000
  )}; SameSite=Lax${securePart}`;
}

function ensureAdmin(req, res) {
  const session = getSession(req);
  if (!session?.isAdmin) {
    json(res, 401, { error: "admin login required" });
    return null;
  }

  return session;
}

async function ensureSchema() {
  if (!pool) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS apps (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      link TEXT NOT NULL,
      description TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS mail_accounts (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function checkDatabase() {
  if (!pool) {
    dbConnected = false;
    schemaReady = false;
    lastDatabaseCheckAt = 0;
    return;
  }

  await pool.query("SELECT 1");
  await ensureSchema();
  dbConnected = true;
  schemaReady = true;
  lastDatabaseCheckAt = Date.now();
}

async function refreshDatabaseStatus() {
  if (!pool) {
    dbConnected = false;
    schemaReady = false;
    lastDatabaseCheckAt = 0;
    return false;
  }

  if (dbConnected && Date.now() - lastDatabaseCheckAt < DATABASE_STATUS_TTL_MS) {
    return true;
  }

  try {
    await pool.query("SELECT 1");
    if (!schemaReady) {
      await ensureSchema();
      schemaReady = true;
    }
    dbConnected = true;
    lastDatabaseCheckAt = Date.now();
    return true;
  } catch (error) {
    dbConnected = false;
    lastDatabaseCheckAt = Date.now();
    throw error;
  }
}

function refreshDatabaseStatusInBackground() {
  if (databaseRefreshInFlight) return databaseRefreshInFlight;

  databaseRefreshInFlight = refreshDatabaseStatus()
    .catch(() => {
      // Keep cached status if the background refresh fails.
    })
    .finally(() => {
      databaseRefreshInFlight = null;
    });

  return databaseRefreshInFlight;
}

async function ensureDatabase(res) {
  try {
    const ok = await refreshDatabaseStatus();
    if (ok) return true;
  } catch {
    // dbConnected is updated in refreshDatabaseStatus
  }

  json(res, 503, { error: "database unavailable" });
  return false;
}

function createId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

async function handleStatus(req, res) {
  if (Date.now() - lastDatabaseCheckAt > DATABASE_STATUS_TTL_MS) {
    refreshDatabaseStatusInBackground();
  }

  const session = getSession(req);
  json(res, 200, {
    dbConnected,
    adminAuthenticated: Boolean(session?.isAdmin),
  });
}

async function handleHealth(_req, res) {
  try {
    await refreshDatabaseStatus();
  } catch {
    // report latest dbConnected state below
  }

  json(res, dbConnected ? 200 : 503, {
    ok: dbConnected,
  });
}

async function handleAdminLogin(req, res) {
  const ip = getClientIp(req);
  const loginState = getLoginState(ip);
  if (loginState.lockedUntil && loginState.lockedUntil > Date.now()) {
    const retryAfterSeconds = Math.ceil((loginState.lockedUntil - Date.now()) / 1000);
    json(
      res,
      429,
      { error: `too many login attempts. try again in ${retryAfterSeconds}s` },
      { "Retry-After": String(retryAfterSeconds) }
    );
    return;
  }

  const body = await readBody(req);
  if (body.password !== ADMIN_PASSWORD) {
    const failure = recordFailedLogin(ip);
    console.warn(`admin login failed from ${ip} (${failure.count} attempts in window)`);
    json(res, 401, { error: "invalid admin password" });
    return;
  }

  clearLoginAttempts(ip);
  const token = createSession();
  json(
    res,
    200,
    { ok: true },
    {
      "Set-Cookie": sessionCookie(token),
    }
  );
}

async function handleAdminLogout(_req, res) {
  json(
    res,
    200,
    { ok: true },
    {
      "Set-Cookie": sessionCookie("", true),
    }
  );
}

async function handleAddApp(req, res) {
  if (!ensureAdmin(req, res)) return;
  if (!(await ensureDatabase(res))) return;
  const body = await readBody(req);

  if (!body.name || !body.link || !body.description) {
    json(res, 400, { error: "name, link, and description are required" });
    return;
  }

  const id = createId("app");
  await pool.query(
    "INSERT INTO apps (id, name, link, description) VALUES ($1, $2, $3, $4)",
    [id, body.name.trim(), body.link.trim(), body.description.trim()]
  );

  json(res, 201, { ok: true, id });
}

async function handleListApps(_req, res) {
  if (!(await ensureDatabase(res))) return;
  const result = await pool.query(`
    SELECT name, description, link
    FROM apps
    ORDER BY created_at DESC, name ASC
  `);
  json(res, 200, { apps: result.rows });
}

async function handleBulkAddApps(req, res) {
  if (!ensureAdmin(req, res)) return;
  if (!(await ensureDatabase(res))) return;
  const body = await readBody(req);
  const apps = Array.isArray(body.apps) ? body.apps : [];

  if (!apps.length) {
    json(res, 400, { error: "apps array is required" });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const app of apps) {
      if (!app.name || !app.link || !app.description) {
        throw new Error("each app must include name, link, and description");
      }

      await client.query(
        "INSERT INTO apps (id, name, link, description) VALUES ($1, $2, $3, $4)",
        [createId("app"), app.name.trim(), app.link.trim(), app.description.trim()]
      );
    }

    await client.query("COMMIT");
    json(res, 201, { ok: true, inserted: apps.length });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function handleBulkAddMails(req, res) {
  if (!ensureAdmin(req, res)) return;
  if (!(await ensureDatabase(res))) return;
  const body = await readBody(req);
  const mails = Array.isArray(body.mails) ? body.mails : [];

  if (!mails.length) {
    json(res, 400, { error: "mails array is required" });
    return;
  }

  const client = await pool.connect();
  let inserted = 0;
  try {
    await client.query("BEGIN");

    for (const mail of mails) {
      if (!mail.accountEmail) {
        throw new Error("each mail account must include an email");
      }

      const email = mail.accountEmail.trim().toLowerCase();
      const result = await client.query(
        `INSERT INTO mail_accounts (id, email)
         VALUES ($1, $2)
         ON CONFLICT (email) DO NOTHING`,
        [createId("account"), email]
      );
      inserted += result.rowCount || 0;
    }

    await client.query("COMMIT");
    json(res, 201, { ok: true, inserted });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function handleListMailAccounts(_req, res) {
  if (!(await ensureDatabase(res))) return;
  const result = await pool.query(`
    SELECT email
    FROM mail_accounts
    ORDER BY email ASC
  `);
  json(res, 200, { mails: result.rows.map((row) => row.email) });
}

async function handleSeed(req, res) {
  if (!ensureAdmin(req, res)) return;
  if (!(await ensureDatabase(res))) return;

  const counts = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM apps) AS app_count,
      (SELECT COUNT(*)::int FROM mail_accounts) AS mail_account_count
  `);

  if (counts.rows[0].app_count > 0 || counts.rows[0].mail_account_count > 0) {
    json(res, 200, { inserted: false });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      "INSERT INTO mail_accounts (id, email) VALUES ($1, $2)",
      [createId("account"), "primary@gmail.com"]
    );

    await client.query(
      "INSERT INTO apps (id, name, link, description) VALUES ($1, $2, $3, $4)",
      [createId("app"), "VS Code", "https://code.visualstudio.com/download", "Primary editor for daily development work."]
    );

    await client.query(
      "INSERT INTO apps (id, name, link, description) VALUES ($1, $2, $3, $4)",
      [createId("app"), "Brave Browser", "https://brave.com/download/", "Fast browser for work, testing, and private browsing."]
    );

    await client.query("COMMIT");
    json(res, 200, { inserted: true });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function getSafeTableName(value) {
  if (!VALID_TABLES.has(value)) {
    throw new Error("invalid table name");
  }

  return value;
}

async function handleDbTables(req, res) {
  if (!ensureAdmin(req, res)) return;
  if (!(await ensureDatabase(res))) return;

  const existingTables = await pool.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = ANY($1::text[])
    ORDER BY table_name
  `, [[...VALID_TABLES]]);

  const tables = [];
  for (const row of existingTables.rows) {
    const safeTable = row.table_name;
    const countResult = await pool.query(`SELECT COUNT(*)::int AS row_count FROM ${safeTable}`);
    tables.push({
      name: safeTable,
      row_count: countResult.rows[0].row_count,
    });
  }

  json(res, 200, { tables });
}

async function handleDbTable(req, res, tableName) {
  if (!ensureAdmin(req, res)) return;
  if (!(await ensureDatabase(res))) return;
  const safeTable = getSafeTableName(tableName);
  const result = await pool.query(`SELECT * FROM ${safeTable} ORDER BY 1 DESC LIMIT 50`);
  json(res, 200, { rows: result.rows });
}

async function handleWipeAllData(req, res) {
  if (!ensureAdmin(req, res)) return;
  if (!(await ensureDatabase(res))) return;
  await pool.query("TRUNCATE TABLE mail_accounts, apps RESTART IDENTITY CASCADE");
  json(res, 200, { ok: true });
}

async function handleWipeTableData(req, res, tableName) {
  if (!ensureAdmin(req, res)) return;
  if (!(await ensureDatabase(res))) return;
  const safeTable = getSafeTableName(tableName);
  await pool.query(`TRUNCATE TABLE ${safeTable} RESTART IDENTITY CASCADE`);
  json(res, 200, { ok: true });
}

async function handleDropTable(req, res, tableName) {
  if (!ensureAdmin(req, res)) return;
  if (!(await ensureDatabase(res))) return;
  const safeTable = getSafeTableName(tableName);
  await pool.query(`DROP TABLE IF EXISTS ${safeTable} CASCADE`);
  await ensureSchema();
  schemaReady = true;
  json(res, 200, { ok: true });
}

async function serveFile(req, res, pathname) {
  const target = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");

  if (target.includes("..") || target.startsWith(".")) {
    notFound(res);
    return;
  }

  const publicRoot = resolve(PUBLIC_ROOT);
  const filePath = resolve(join(publicRoot, target));
  const insidePublic = filePath === publicRoot || filePath.startsWith(`${publicRoot}${sep}`);

  if (!insidePublic || !existsSync(filePath) || !statSync(filePath).isFile()) {
    const fallback = resolve(join(publicRoot, "index.html"));
    if (existsSync(fallback) && statSync(fallback).isFile()) {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
      });
      createReadStream(fallback).pipe(res);
      return;
    }

    notFound(res);
    return;
  }

  const ext = extname(filePath);
  res.writeHead(200, {
    "Content-Type": mimeTypes[ext] || "application/octet-stream",
  });
  createReadStream(filePath).pipe(res);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === "/api/status" && req.method === "GET") {
      await handleStatus(req, res);
      return;
    }

    if (url.pathname === "/healthz" && req.method === "GET") {
      await handleHealth(req, res);
      return;
    }

    if (url.pathname === "/api/admin/login" && req.method === "POST") {
      await handleAdminLogin(req, res);
      return;
    }

    if (url.pathname === "/api/admin/logout" && req.method === "POST") {
      await handleAdminLogout(req, res);
      return;
    }

    if (url.pathname === "/api/apps" && req.method === "POST") {
      await handleAddApp(req, res);
      return;
    }

    if (url.pathname === "/api/apps" && req.method === "GET") {
      await handleListApps(req, res);
      return;
    }

    if (url.pathname === "/api/apps/bulk" && req.method === "POST") {
      await handleBulkAddApps(req, res);
      return;
    }

    if (url.pathname === "/api/mail-accounts" && req.method === "GET") {
      await handleListMailAccounts(req, res);
      return;
    }

    if (url.pathname === "/api/mails/bulk" && req.method === "POST") {
      await handleBulkAddMails(req, res);
      return;
    }

    if (url.pathname === "/api/seed" && req.method === "POST") {
      await handleSeed(req, res);
      return;
    }

    if (url.pathname === "/api/db/tables" && req.method === "GET") {
      await handleDbTables(req, res);
      return;
    }

    if (url.pathname.startsWith("/api/db/table/") && req.method === "GET") {
      await handleDbTable(req, res, decodeURIComponent(url.pathname.slice("/api/db/table/".length)));
      return;
    }

    if (url.pathname === "/api/db/data/all" && req.method === "DELETE") {
      await handleWipeAllData(req, res);
      return;
    }

    if (url.pathname.startsWith("/api/db/data/") && req.method === "DELETE") {
      await handleWipeTableData(req, res, decodeURIComponent(url.pathname.slice("/api/db/data/".length)));
      return;
    }

    if (url.pathname.startsWith("/api/db/table/") && req.method === "DELETE") {
      await handleDropTable(req, res, decodeURIComponent(url.pathname.slice("/api/db/table/".length)));
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      notFound(res);
      return;
    }

    await serveFile(req, res, url.pathname);
  } catch (error) {
    console.error(error);
    json(res, 500, { error: error.message || "server error" });
  }
});

try {
  await checkDatabase();
} catch (error) {
  console.error("database boot failed", error);
}

if (!ADMIN_PASSWORD) {
  console.warn("ADMIN_PASSWORD is not set. Admin login will not work until it is configured.");
}

server.listen(PORT, () => {
  console.log(`Knull server running at http://localhost:${PORT}`);
});
