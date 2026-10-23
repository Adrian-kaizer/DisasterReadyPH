# Deploy DisasterReady PH to Netlify

The site is built as static files and Netlify Functions. Neon PostgreSQL stores
accounts, password hashes, sessions, and profile pictures. The local
`node server.js` and SQLite workflow remain available.

## 1. Create the Neon database

1. Create a PostgreSQL project in Neon.
2. Open the Neon SQL editor and run [`database/neon-schema.sql`](./database/neon-schema.sql).
3. Copy the database connection string. Keep it private.

## 2. Install and configure

Use Node.js 22 or newer. In the project folder, run:

```powershell
npm install
Copy-Item .env.example .env
```

Edit `.env` and replace the example `DATABASE_URL` with the Neon connection
string. Do not commit `.env`; it is ignored by Git.

## 3. Preserve existing local accounts

With `.env` configured and the Neon schema installed, run:

```powershell
node migrate-sqlite-to-neon.js
```

The migration copies account email, existing salted password hashes, roles,
statuses, and profile pictures. It does not copy browser-local checklist,
station, or hazard-report data. It stops if any email already exists in Neon;
resolve account conflicts before retrying.

## 4. Create the private admin account

After migration, if no admin account exists, run:

```powershell
node create-admin-neon.js admin@gmail.com
```

Choose and confirm the admin password in the terminal. Only one admin account
is permitted, and public sign-up always creates a regular user.

## 5. Test locally with Netlify

```powershell
npm run dev
```

Netlify CLI prints the local URL, usually `http://localhost:8888`. Test account
creation, sign-in, profile-picture upload, account deletion, sign-out,
evacuation-map search, and refresh of protected pages.

The existing `node server.js` and `start-app.bat` remain the separate local
SQLite option at `http://127.0.0.1:3000`.

## 6. Deploy

1. Push the project to a Git repository and import it into Netlify.
2. Set the Netlify environment variable `DATABASE_URL` to the Neon connection
   string. Set it for the deploy contexts you use; never put it in frontend
   JavaScript or a committed file.
3. Deploy. Netlify runs `npm run build`, publishes `dist`, and deploys the
   functions in `netlify/functions`.
4. Open the Netlify site URL and sign in with a migrated account or create a
   new one.

The deployment does not publish the local SQLite database, source server,
admin setup scripts, or `.env`.

The checklist, manually entered water stations/readings, and hazard reports
remain in each browser's local storage; they are not synchronized between
devices or users.
