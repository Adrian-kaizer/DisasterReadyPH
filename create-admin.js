"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const { promisify } = require("node:util");
const { DatabaseSync } = require("node:sqlite");

const scrypt = promisify(crypto.scrypt);
const email = (process.argv[2] || "admin@gmail.com").trim().toLowerCase();
const passwordBytes = 64;
const scryptOptions = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const databasePath = path.join(__dirname, "database", "users.sqlite");

function promptSecret(prompt) {
    if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
        return Promise.reject(
            new Error("Run this command from an interactive terminal to enter the password safely.")
        );
    }

    return new Promise((resolve, reject) => {
        let value = "";
        process.stdout.write(prompt);
        process.stdin.setEncoding("utf8");
        process.stdin.setRawMode(true);
        process.stdin.resume();

        function finish(error) {
            process.stdin.setRawMode(false);
            process.stdin.pause();
            process.stdin.removeListener("data", onData);
            process.stdout.write("\n");
            if (error) reject(error);
            else resolve(value);
        }

        function onData(chunk) {
            for (const character of chunk) {
                if (character === "\u0003") {
                    finish(new Error("Admin account setup cancelled."));
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
        }

        process.stdin.on("data", onData);
    });
}

async function main() {
    if (
        email.length < 3 ||
        email.length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
        throw new Error("Provide a valid admin email address.");
    }

    const database = new DatabaseSync(databasePath);
    try {
        const columns = new Set(
            database.prepare("PRAGMA table_info(users)").all().map(column => column.name)
        );
        if (!columns.has("role")) {
            throw new Error(
                "The database has not been migrated. Start the app server once, then run this command again."
            );
        }

        const existingAdmin = database.prepare(
            "SELECT email FROM users WHERE role = 'admin'"
        ).get();
        if (existingAdmin) {
            throw new Error("An admin account already exists. Only one admin account is allowed.");
        }

        const existingUser = database.prepare(
            "SELECT email FROM users WHERE email = ?"
        ).get(email);
        if (existingUser) {
            throw new Error(
                "An account with this email already exists. Choose a different admin email."
            );
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
        const hash = await scrypt(password, salt, passwordBytes, scryptOptions);
        database.prepare(
            "INSERT INTO users (email, password_salt, password_hash, role, status) " +
            "VALUES (?, ?, ?, 'admin', 'active')"
        ).run(email, salt.toString("hex"), hash.toString("hex"));

        console.log(`Private admin account created for ${email}.`);
        console.log("Sign in through the app. No admin sign-up is available on the public form.");
    } finally {
        database.close();
    }
}

main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});
