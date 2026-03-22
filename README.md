# Knull Terminal Vault

Minimal terminal-style personal site built with plain HTML, CSS, and JavaScript.

## Current behavior

- Shows only an ASCII `Knull` header and intro lines on load
- Uses one command input like a terminal
- `help` shows available commands
- `add` starts a guided flow for apps or mails
- `seed` inserts sample data
- Uses local storage by default
- Can switch to Turso when you add credentials

## Run

Do not open `index.html` directly with `file://`.

Use a local server instead:

```powershell
cd D:\simplecmd
python -m http.server 8080
```

Then open [http://localhost:8080](http://localhost:8080).

## Commands

- `help`
- `add`
- `seed`
- `clear`
- `cls`

## Turso setup

1. Create a Turso database.
2. Run the SQL from `schema.sql`.
3. Open [`.env`](D:\simplecmd\.env)
4. Add your Turso values:

```env
TURSO_DATABASE_URL=libsql://your-database-name.turso.io
TURSO_AUTH_TOKEN=your-token-here
```

If the `.env` values are empty, the app stays on local storage automatically.

Note: this browser-based `.env` loading is fine for your personal local use, but it is not suitable for a public production deployment because the browser can access those values.
