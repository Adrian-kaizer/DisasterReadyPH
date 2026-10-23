import {
    getSession,
    json,
    methodNotAllowed,
    sql,
    withErrors
} from "./lib/shared.mjs";

export const handler = withErrors(async event => {
    if (event.httpMethod !== "GET") return methodNotAllowed("GET");
    const session = await getSession(event);
    if (!session) return json(401, { error: "Sign in to view your profile." });

    const profiles = await sql()`
        SELECT email, role, status, profile_picture_data
        FROM users
        WHERE id = ${session.id}
        LIMIT 1
    `;
    if (!profiles.length) return json(401, { error: "The signed-in account was not found." });

    return json(200, {
        email: profiles[0].email,
        role: profiles[0].role,
        status: profiles[0].status,
        hasProfilePicture: Boolean(profiles[0].profile_picture_data)
    });
});
