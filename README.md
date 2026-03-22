# Knull Terminal Vault

Terminal-style personal site with:

- plain HTML, CSS, and JavaScript frontend
- Node backend
- Neon PostgreSQL database
- admin-only add commands

## Current behavior

- shows only the ASCII `Knull` header and boot lines on load
- uses one terminal input
- checks real Neon connection on startup
- only admin can add apps and mails
- admin login commands are `login` or `admin`
- admin password is read from `.env`

## Environment

Set these in [`.env`](D:\simplecmd\.env):

```env
NEON_DATABASE_URL=postgresql://...
NEON_DATABASE_URL_UNPOOLED=postgresql://...
ADMIN_PASSWORD=Knull@123
PORT=3000
```

## Install and run

```powershell
cd D:\simplecmd
npm install
npm start
```

Then open [http://localhost:3000](http://localhost:3000).

## Commands

- `help`
- `login`
- `admin`
- `logout`
- `add`
- apps bulk format: `name,link,description|name,link,description`
- mails bulk format: one mail per line as `email,sender,subject,snippet,body`
- `db`
- `db <table>`
- `wipe all data`
- `wipe data from <table>`
- `wipe <table>`
- `seed`
- `clear`
- `cls`
