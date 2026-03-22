const STORAGE_KEY = "personal-terminal-vault";
let cachedEnvConfig;

function createId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function emptyState() {
  return {
    apps: [],
    accounts: [],
    mails: [],
  };
}

function readLocalState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return emptyState();

  try {
    const parsed = JSON.parse(raw);
    return {
      apps: Array.isArray(parsed.apps) ? parsed.apps : [],
      accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
      mails: Array.isArray(parsed.mails) ? parsed.mails : [],
    };
  } catch {
    return emptyState();
  }
}

function writeLocalState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

async function tryCreateTursoClient() {
  const config = (await readRuntimeConfig()) || window.TURSO_CONFIG;
  if (!config?.url || !config?.authToken) return null;

  const module = await import("https://esm.sh/@libsql/client/web");
  return module.createClient({
    url: config.url,
    authToken: config.authToken,
  });
}

async function readRuntimeConfig() {
  if (cachedEnvConfig !== undefined) return cachedEnvConfig;

  try {
    const response = await fetch("./.env", { cache: "no-store" });
    if (!response.ok) {
      cachedEnvConfig = null;
      return cachedEnvConfig;
    }

    const text = await response.text();
    const values = {};

    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;

      const separatorIndex = line.indexOf("=");
      if (separatorIndex === -1) continue;

      const key = line.slice(0, separatorIndex).trim();
      const value = line.slice(separatorIndex + 1).trim();
      values[key] = value;
    }

    if (!values.TURSO_DATABASE_URL || !values.TURSO_AUTH_TOKEN) {
      cachedEnvConfig = null;
      return cachedEnvConfig;
    }

    cachedEnvConfig = {
      url: values.TURSO_DATABASE_URL,
      authToken: values.TURSO_AUTH_TOKEN,
    };
    return cachedEnvConfig;
  } catch {
    cachedEnvConfig = null;
    return cachedEnvConfig;
  }
}

async function ensureTursoSchema(client) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS apps (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      link TEXT NOT NULL,
      description TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS mail_accounts (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS mails (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      sender TEXT NOT NULL,
      subject TEXT NOT NULL,
      snippet TEXT NOT NULL,
      body TEXT NOT NULL,
      received_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(account_id) REFERENCES mail_accounts(id)
    )`,
  ];

  for (const sql of statements) {
    await client.execute(sql);
  }
}

class LocalDatabase {
  constructor() {
    this.status = {
      connected: true,
      backend: "local",
      lines: [
        "local storage ready",
        "offline mode active",
      ],
    };
  }

  async init() {
    const probeKey = `${STORAGE_KEY}-probe`;
    localStorage.setItem(probeKey, "ok");
    localStorage.removeItem(probeKey);
    return this;
  }

  async addApp(payload) {
    const state = readLocalState();
    state.apps.unshift({
      id: createId("app"),
      createdAt: new Date().toISOString(),
      ...payload,
    });
    writeLocalState(state);
  }

  async addMail(payload) {
    const state = readLocalState();
    const normalizedEmail = payload.accountEmail.trim().toLowerCase();
    let account = state.accounts.find((item) => item.email === normalizedEmail);

    if (!account) {
      account = {
        id: createId("account"),
        email: normalizedEmail,
        createdAt: new Date().toISOString(),
      };
      state.accounts.unshift(account);
    }

    state.mails.unshift({
      id: createId("mail"),
      accountId: account.id,
      accountEmail: account.email,
      sender: payload.sender,
      subject: payload.subject,
      snippet: payload.snippet,
      body: payload.body,
      receivedAt: payload.receivedAt,
      createdAt: new Date().toISOString(),
    });

    writeLocalState(state);
  }

  async seed() {
    const state = readLocalState();
    if (state.apps.length || state.mails.length) return false;

    const now = new Date().toISOString();
    const account = {
      id: createId("account"),
      email: "primary@gmail.com",
      createdAt: now,
    };

    state.accounts.push(account);
    state.apps.push(
      {
        id: createId("app"),
        name: "VS Code",
        link: "https://code.visualstudio.com/download",
        description: "Primary editor for daily development work.",
        createdAt: now,
      },
      {
        id: createId("app"),
        name: "Brave Browser",
        link: "https://brave.com/download/",
        description: "Fast browser for work, testing, and private browsing.",
        createdAt: now,
      }
    );
    state.mails.push({
      id: createId("mail"),
      accountId: account.id,
      accountEmail: account.email,
      sender: "alerts@example.com",
      subject: "Security check completed",
      snippet: "No new threats detected in your account.",
      body: "Daily summary: all systems look stable. No unusual sign-ins were detected.",
      receivedAt: now,
      createdAt: now,
    });

    writeLocalState(state);
    return true;
  }
}

class TursoDatabase {
  constructor(client) {
    this.client = client;
    this.status = {
      connected: false,
      backend: "turso",
      lines: [],
    };
  }

  async init() {
    await this.client.execute("SELECT 1");
    await ensureTursoSchema(this.client);
    this.status = {
      connected: true,
      backend: "turso",
      lines: [
        "turso connection verified",
        "auth token accepted",
        "schema ready",
      ],
    };
    return this;
  }

  async addApp(payload) {
    await this.client.execute({
      sql: "INSERT INTO apps (id, name, link, description, created_at) VALUES (?, ?, ?, ?, ?)",
      args: [createId("app"), payload.name, payload.link, payload.description, new Date().toISOString()],
    });
  }

  async addMail(payload) {
    const email = payload.accountEmail.trim().toLowerCase();
    const accountLookup = await this.client.execute({
      sql: "SELECT id FROM mail_accounts WHERE email = ?",
      args: [email],
    });

    let accountId = accountLookup.rows[0]?.id;
    if (!accountId) {
      accountId = createId("account");
      await this.client.execute({
        sql: "INSERT INTO mail_accounts (id, email, created_at) VALUES (?, ?, ?)",
        args: [accountId, email, new Date().toISOString()],
      });
    }

    await this.client.execute({
      sql: `INSERT INTO mails
        (id, account_id, sender, subject, snippet, body, received_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        createId("mail"),
        accountId,
        payload.sender,
        payload.subject,
        payload.snippet,
        payload.body,
        payload.receivedAt,
        new Date().toISOString(),
      ],
    });
  }

  async seed() {
    const apps = await this.client.execute("SELECT COUNT(*) AS total FROM apps");
    const mails = await this.client.execute("SELECT COUNT(*) AS total FROM mails");
    if (Number(apps.rows[0].total) > 0 || Number(mails.rows[0].total) > 0) return false;

    const now = new Date().toISOString();
    const accountId = createId("account");

    await this.client.batch([
      {
        sql: "INSERT INTO mail_accounts (id, email, created_at) VALUES (?, ?, ?)",
        args: [accountId, "primary@gmail.com", now],
      },
      {
        sql: "INSERT INTO apps (id, name, link, description, created_at) VALUES (?, ?, ?, ?, ?)",
        args: [createId("app"), "VS Code", "https://code.visualstudio.com/download", "Primary editor for daily development work.", now],
      },
      {
        sql: "INSERT INTO apps (id, name, link, description, created_at) VALUES (?, ?, ?, ?, ?)",
        args: [createId("app"), "Brave Browser", "https://brave.com/download/", "Fast browser for work, testing, and private browsing.", now],
      },
      {
        sql: `INSERT INTO mails
          (id, account_id, sender, subject, snippet, body, received_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          createId("mail"),
          accountId,
          "alerts@example.com",
          "Security check completed",
          "No new threats detected in your account.",
          "Daily summary: all systems look stable. No unusual sign-ins were detected.",
          now,
          now,
        ],
      },
    ]);

    return true;
  }
}

export async function createDatabase() {
  const client = await tryCreateTursoClient();
  if (!client) return new LocalDatabase().init();

  try {
    return await new TursoDatabase(client).init();
  } catch (error) {
    console.error("Falling back to local storage:", error);
    const fallback = await new LocalDatabase().init();
    fallback.status = {
      connected: true,
      backend: "local",
      lines: [
        "turso connection failed",
        "fallback to local storage",
      ],
    };
    return fallback;
  }
}
