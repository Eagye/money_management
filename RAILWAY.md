# Deploying on Railway (SQLite)

Railway offers PostgreSQL, but this app uses **SQLite**. You do **not** need to add a Postgres service to run it.

The important part: Railway’s app disk is **ephemeral** (wiped on redeploy). Put the database on a **persistent volume**.

## Steps

1. **Create a Railway project** and deploy this repo (Node.js, start command: `npm start`).

2. **Add a volume** to your web service:
   - Service → **Volumes** → **Add Volume**
   - Mount path: `/data`

3. **Set environment variables** (Service → Variables):

   | Variable | Example |
   |----------|---------|
   | `DATABASE_PATH` | `/data/lucky_susu.db` |
   | `JWT_SECRET` | (64-char random hex) |
   | `NODE_ENV` | `production` |
   | `PORT` | `3000` (Railway sets `PORT` automatically; app reads it) |
   | `ALLOWED_ORIGINS` | `https://your-app.up.railway.app` |
   | `ADMIN_EMAIL` | `admin@luckysusu.com` (or your admin email) |
   | `ADMIN_PASSWORD` | strong password (never commit to git) |
   | `SYSTEM_API_KEY` | Arkesel API key |
   | `SMS_API_URL` | `https://sms.arkesel.com/api/v2/sms/send` |
   | `SMS_SENDER_ID` | your approved sender ID |

4. **Redeploy** after adding the volume and variables.

5. **Create admin** (one time) — choose one method:

   **A. No SSH (easiest)** — add variable `BOOTSTRAP_ADMIN=true`, redeploy once, then **remove** that variable:
   - Requires `ADMIN_EMAIL` and `ADMIN_PASSWORD` already set
   - On startup the app deletes old admins and creates the new admin automatically

   **B. Railway SSH / CLI** (if your account is linked):
   ```bash
   node create_admin.js
   ```

6. **Arkesel webhook** (optional): point delivery callback to  
   `https://your-app.up.railway.app/api/webhooks/arkesel/delivery`

## Migrating existing local data

Copy your local `lucky_susu.db` (and if present `lucky_susu.db-wal`, `lucky_susu.db-shm`) into the volume path, or upload via Railway CLI/shell to `/data/`.

## When to use PostgreSQL instead

Stay on SQLite + volume if you have moderate traffic and a single app instance.

Consider PostgreSQL later if you need:
- multiple app replicas writing at once
- very high concurrent write load
- managed backups/HA from Railway’s Postgres

That would require a larger migration (this codebase is built around `sqlite3` today).
