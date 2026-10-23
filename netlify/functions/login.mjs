import {
    consumeAuthAttempt,
    hashPassword,
    isEmailValid,
    isSameOrigin,
    issueSession,
    json,
    methodNotAllowed,
    PASSWORD_HASH_BYTES,
    passwordMatches,
    readJson,
    sql,
    withErrors
} from "./lib/shared.mjs";

export const handler = withErrors(async event => {
    if (event.httpMethod !== "POST") return methodNotAllowed("POST");
    if (!isSameOrigin(event)) return json(403, { error: "Request origin not allowed." });
    if (!await consumeAuthAttempt(event)) {
        return json(429, { error: "Too many sign-in attempts. Please try again in 15 minutes." });
    }

    const body = readJson(event);
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!isEmailValid(email) || !password || password.length > 128) {
        return json(401, { error: "Email or password is incorrect." });
    }

    const users = await sql()`
        SELECT email, password_salt, password_hash, status
        FROM users
        WHERE LOWER(email) = ${email}
        LIMIT 1
    `;
    const user = users[0];
    const salt = user ? Buffer.from(user.password_salt, "hex") : Buffer.alloc(16);
    const expectedHash = user?.password_hash
        || Buffer.alloc(PASSWORD_HASH_BYTES).toString("hex");
    const actualHash = await hashPassword(password, salt);
    const validPassword = passwordMatches(actualHash, expectedHash);

    if (!user || !validPassword || user.status !== "active") {
        return json(401, { error: "Email or password is incorrect." });
    }

    return issueSession(event, user.email);
});
