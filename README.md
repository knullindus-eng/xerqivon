# Knull Terminal Vault

Terminal-style personal site with a plain HTML/CSS/JS frontend, a Node backend, and Neon PostgreSQL.

## Local run

```powershell
cd D:\simplecmd
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000).

## Desktop app with Tauri

This repo now includes a Tauri desktop shell in [src-tauri](D:\simplecmd\src-tauri).

- In development, the desktop app opens your local site at `http://127.0.0.1:3000`
- In production build, the desktop app opens your deployed site at `https://xerqivon.onrender.com`

### Requirements

- Node.js
- Rust toolchain (`rustup`, `cargo`, `rustc`)

### Tauri commands

```powershell
cd D:\simplecmd
npm install
npm run tauri:dev
```

To build a Windows app:

```powershell
cd D:\simplecmd
npm run tauri:build
```

If `cargo` or `rustc` is missing, install Rust first from [https://www.rust-lang.org/tools/install](https://www.rust-lang.org/tools/install).

## Environment

Create `.env` from [`.env.example`](D:\simplecmd\.env.example) and set:

```env
NEON_DATABASE_URL=postgresql://...
NEON_DATABASE_URL_UNPOOLED=postgresql://...
ADMIN_PASSWORD=change-this-password
PORT=3000
```

The server now reads both `.env` and real environment variables, so it works locally and on Render.

## Render deploy

This repo now includes [render.yaml](D:\simplecmd\render.yaml).

Set these environment variables in Render:

- `NEON_DATABASE_URL`
- `NEON_DATABASE_URL_UNPOOLED`
- `ADMIN_PASSWORD`
- `NODE_ENV=production`

Render will use:

- build command: `npm install`
- start command: `npm start`
- health check: `/healthz`

## Commands

- `help`
- `login`
- `admin`
- `logout`
- `apps`
- `mails`
- `mails=gmail`
- `mails=yhoo`
- `add`
- apps bulk format: `name,link,description|name,link,description`
- mails bulk format: `email1,email2,email3` or one email per line
- `db`
- `db <table>`
- `wipe all`
- `wipe all data`
- `wipe data from <table>`
- `wipe <table>`
- `seed`
- `clear`
- `cls`

## Important

Do not commit your real `.env`.
If your real Neon credentials were already pushed earlier, rotate them in Neon before deploying.
