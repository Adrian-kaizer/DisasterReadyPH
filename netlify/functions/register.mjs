import {
    consumeAuthAttempt,
    hashPassword,
    isEmailValid,
    isSameOrigin,
    issueSession,
    json,
    methodNotAllowed,
    readJson,
    sql,
    withErrors
} from "./lib/shared.mjs";
import { randomBytes } from "node:crypto";

export const handler = withErrors(async event => {
    if (event.httpMethod !== "POST") return methodNotAllowed("POST");
    if (!isSameOrigin(event)) return json(403, { error: "Request origin not allowed." });
    if (!await consumeAuthAttempt(event)) {
        return json(429, { error: "Too many attempts. Please try again in 15 minutes." });
    }

    const body = readJson(event);
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!isEmailValid(email)) return json(400, { error: "Enter a valid email address." });
    if (password.length < 12 || password.length > 128) {
        return json(400, { error: "Use a password between 12 and 128 characters." });
    }

    const salt = randomBytes(16);
    const passwordHash = await hashPassword(password, salt);

    try {
        const created = await sql()`
            INSERT INTO users (email, password_salt, password_hash, role, status)
            VALUES (${email}, ${salt.toString("hex")}, ${passwordHash.toString("hex")}, 'user', 'active')
            RETURNING email
        `;
        if (!created.length) throw new Error("The account could not be created.");
    } catch (error) {
        if (error.code === "23505") {
            return json(409, { error: "An account with that email already exists." });
        }
        throw error;
    }

    return issueSession(event, email);
});
