"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { promisify } = require("node:util");
const { neon } = require("@neondatabase/serverless");

const scrypt = promisify(crypto.scrypt);
const email = (process.argv[2] || "admin@gmail.com").trim().toLowerCase();
const scryptOptions = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

if (!process.env.DATABASE_URL && fs.existsSync(path.join(__dirname, ".env"))) {
    process.loadEnvFile(path.join(__dirname, ".env"));
}

function promptSecret(prompt) {
    if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
        return Promise.reject(new Error("Run this command from an interactive terminal."));
    }

    return new Promise((resolve, reject) => {
        let value = "";
        process.stdout.write(prompt);
        process.stdin.setEncoding("utf8");
        process.stdin.setRawMode(true);
        process.stdin.resume();

        const finish = error => {
            process.stdin.setRawMode(false);
            process.stdin.pause();
            process.stdin.removeListener("data", onData);
            process.stdout.write("\n");
            if (error) reject(error);
            else resolve(value);
        };

        const onData = chunk => {
            for (const character of chunk) {
                if (character === "\u0003") {
                    finish(new Error("Admin setup cancelled."));
                    return;
                }
                if (character === "\r" || character === "\n") {
                    finish();
                    return;
                }
                if (character === "\u007f" || character === "\b") {
                    if (value.length) {
                        value = value.slice(0, -1);
                        process.stdout.write("\b \b");
                    }
                    continue;
                }
                if (character >= " " && character !== "\u007f") {
                    value += character;
                    process.stdout.write(character);
                }
            }
        };

        process.stdin.on("data", onData);
    });
}

async function main() {
    if (!process.env.DATABASE_URL) {
        throw new Error("Set DATABASE_URL in .env or your environment first.");
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new Error("Provide a valid admin email address.");
    }

    const sql = neon(process.env.DATABASE_URL);
    const existingAdmin = await sql`
        SELECT id FROM users WHERE role = 'admin' LIMIT 1
    `;
    if (existingAdmin.length) {
        throw new Error("An admin account already exists. Only one admin is allowed.");
    }

    const existingUser = await sql`
        SELECT id FROM users WHERE LOWER(email) = ${email} LIMIT 1
    `;
    if (existingUser.length) {
        throw new Error("An account with this email already exists.");
    }

    const password = await promptSecret("Create admin password (minimum 12 characters): ");
    const confirmation = await promptSecret("Confirm admin password: ");
    if (password.length < 12 || password.length > 128) {
        throw new Error("The admin password must be between 12 and 128 characters.");
    }
    if (password !== confirmation) {
        throw new Error("The passwords do not match.");
    }

    const salt = crypto.randomBytes(16);
    const hash = await scrypt(password, salt, 64, scryptOptions);
    try {
        await sql`
            INSERT INTO users (email, password_salt, password_hash, role, status)
            VALUES (${email}, ${salt.toString("hex")}, ${hash.toString("hex")}, 'admin', 'active')
        `;
    } catch (error) {
        if (error.code === "23505") {
            throw new Error("An admin or account with this email already exists.");
        }
        throw error;
    }

    console.log(`Private admin account created for ${email}.`);
}

main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});
