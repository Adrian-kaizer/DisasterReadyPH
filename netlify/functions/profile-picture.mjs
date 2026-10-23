import {
    getSession,
    isSameOrigin,
    json,
    MAX_PROFILE_PICTURE_BYTES,
    methodNotAllowed,
    readJson,
    sql,
    text,
    validateProfilePicture,
    withErrors
} from "./lib/shared.mjs";

export const handler = withErrors(async event => {
    if (event.httpMethod !== "GET" && event.httpMethod !== "POST") {
        return methodNotAllowed("GET, POST");
    }

    const session = await getSession(event);
    if (!session) return json(401, { error: "Sign in to access your profile picture." });

    if (event.httpMethod === "GET") {
        const profiles = await sql()`
            SELECT profile_picture_data
            FROM users
            WHERE id = ${session.id}
            LIMIT 1
        `;
        const dataUrl = profiles[0]?.profile_picture_data;
        if (!dataUrl) return text(404, "No profile picture.");

        const picture = validateProfilePicture(dataUrl);
        if (picture.error) {
            console.error("Stored profile picture failed validation.");
            return text(500, "Stored profile picture is invalid.");
        }

        return {
            statusCode: 200,
            headers: {
                "Content-Type": picture.mimeType,
                "Cache-Control": "private, no-store",
                "X-Content-Type-Options": "nosniff",
                "Content-Security-Policy": "default-src 'none'; sandbox"
            },
            isBase64Encoded: true,
            body: picture.image.toString("base64")
        };
    }

    if (!isSameOrigin(event)) return json(403, { error: "Request origin not allowed." });

    const body = readJson(event, Math.ceil(MAX_PROFILE_PICTURE_BYTES * 1.4));
    const picture = validateProfilePicture(body.image);
    if (picture.error) return json(400, { error: picture.error });

    const dataUrl = `data:${picture.mimeType};base64,${picture.image.toString("base64")}`;
    await sql()`
        UPDATE users
        SET profile_picture_data = ${dataUrl},
            profile_picture_mime = ${picture.mimeType}
        WHERE id = ${session.id}
    `;

    return json(200, { ok: true });
});
