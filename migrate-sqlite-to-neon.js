"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { neon } = require("@neondatabase/serverless");

if (!process.env.DATABASE_URL && fs.existsSync(path.join(__dirname, ".env"))) {
    process.loadEnvFile(path.join(__dirname, ".env"));
}

async function main() {
    if (!process.env.DATABASE_URL) {
        throw new Error("Set DATABASE_URL in .env or your environment first.");
    }

    const sqlitePath = path.join(__dirname, "database", "users.sqlite");
    if (!fs.existsSync(sqlitePath)) {
        throw new Error(`Local SQLite database not found: ${sqlitePath}`);
    }

    const localDatabase = new DatabaseSync(sqlitePath, { readOnly: true });
    try {
        const columns = new Set(
            localDatabase.prepare("PRAGMA table_info(users)").all().map(column => column.name)
        );
        for (const required of [
            "email",
            "password_salt",
            "password_hash",
            "role",
            "status"
        ]) {
            if (!columns.has(required)) {
                throw new Error(
                    "The local database schema is outdated. Start the local app once and retry."
                );
            }
        }

        const pictureColumnsAvailable =
            columns.has("profile_picture") && columns.has("profile_picture_mime");
        const users = localDatabase.prepare(
            `SELECT email, password_salt, password_hash, role, status${
                pictureColumnsAvailable ? ", profile_picture, profile_picture_mime" : ""
            } FROM users ORDER BY id`
        ).all();

        if (!users.length) {
            console.log("No local accounts to migrate.");
            return;
        }

        const localAdmins = users.filter(user => user.role === "admin");
        if (localAdmins.length > 1) {
            throw new Error("The local database contains more than one admin account.");
        }

        const sql = neon(process.env.DATABASE_URL);
        const existing = await sql`SELECT LOWER(email) AS email FROM users`;
        const existingEmails = new Set(existing.map(user => user.email));
        const conflicts = users.filter(user => existingEmails.has(user.email.toLowerCase()));
        if (conflicts.length) {
            throw new Error(
                `${conflicts.length} account(s) already exist in Neon. Resolve email conflicts before migrating.`
            );
        }

        const existingAdmins = await sql`
            SELECT id FROM users WHERE role = 'admin' LIMIT 1
        `;
        if (existingAdmins.length && localAdmins.length) {
            throw new Error(
                "Neon already has an admin account and the local database also has one. Resolve this before migrating."
            );
        }

        const inserts = users.map(user => {
            let profilePictureData = null;
            let profilePictureMime = null;
            if (user.profile_picture && user.profile_picture_mime) {
                const picture = Buffer.from(user.profile_picture);
                if (picture.length > 512 * 1024) {
                    throw new Error(`Profile picture for ${user.email} exceeds 512 KB.`);
                }
                profilePictureMime = user.profile_picture_mime;
                profilePictureData =
                    `data:${profilePictureMime};base64,${picture.toString("base64")}`;
            }

            return sql`
                INSERT INTO users (
                    email, password_salt, password_hash, role, status,
                    profile_picture_data, profile_picture_mime
                )
                VALUES (
                    ${user.email},
                    ${user.password_salt},
                    ${user.password_hash},
                    ${user.role},
                    ${user.status},
                    ${profilePictureData},
                    ${profilePictureMime}
                )
            `;
        });
        await sql.transaction(inserts);

        console.log(`Migrated ${users.length} account(s) and their profile pictures.`);
        console.log("Local accounts were preserved. Existing sessions will need to sign in again.");
    } finally {
        localDatabase.close();
    }
}

main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});
