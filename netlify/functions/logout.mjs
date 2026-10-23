import {
    clearSessionCookie,
    getSession,
    isSameOrigin,
    json,
    methodNotAllowed,
    sql,
    withErrors
} from "./lib/shared.mjs";

export const handler = withErrors(async event => {
    if (event.httpMethod !== "POST") return methodNotAllowed("POST");
    if (!isSameOrigin(event)) return json(403, { error: "Request origin not allowed." });

    const session = await getSession(event);
    if (session) {
        await sql()`DELETE FROM auth_sessions WHERE token_hash = ${session.tokenHash}`;
    }

    return json(200, { ok: true }, {
        "Set-Cookie": clearSessionCookie(event)
    });
});
