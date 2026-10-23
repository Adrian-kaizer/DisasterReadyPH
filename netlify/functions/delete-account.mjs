import {
    clearSessionCookie,
    consumeAuthAttempt,
    getSession,
    hashPassword,
    isSameOrigin,
    json,
    methodNotAllowed,
    passwordMatches,
    readJson,
    sql,
    withErrors
} from "./lib/shared.mjs";

export const handler = withErrors(async event => {
    if (event.httpMethod !== "POST") return methodNotAllowed("POST");
    if (!isSameOrigin(event)) return json(403, { error: "Request origin not allowed." });

    const session = await getSession(event);
    if (!session) {
        return json(401, { error: "Sign in again to delete your account." });
    }
    if (!await consumeAuthAttempt(event)) {
        return json(429, { error: "Too many attempts. Please try again in 15 minutes." });
    }

    const body = readJson(event);
    const password = typeof body.password === "string" ? body.password : "";
    if (!password || password.length > 128 || body.confirmation !== "DELETE") {
        return json(400, { error: "Enter your password and type DELETE to confirm." });
    }

    const users = await sql()`
        SELECT password_salt, password_hash, status
        FROM users
        WHERE id = ${session.id}
        LIMIT 1
    `;
    const user = users[0];
    if (!user || user.status !== "active") {
        return json(401, { error: "Your account is no longer active." }, {
            "Set-Cookie": clearSessionCookie(event)
        });
    }

    const actualHash = await hashPassword(password, Buffer.from(user.password_salt, "hex"));
    if (!passwordMatches(actualHash, user.password_hash)) {
        return json(401, { error: "The password is incorrect." });
    }

    const deleted = await sql()`
        DELETE FROM users
        WHERE id = ${session.id}
        RETURNING id
    `;
    if (!deleted.length) throw new Error("Expected to delete one account.");

    return json(200, { ok: true }, {
        "Set-Cookie": clearSessionCookie(event)
    });
});
