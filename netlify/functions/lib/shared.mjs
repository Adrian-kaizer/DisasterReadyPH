import {
    randomBytes,
    createHash,
    timingSafeEqual,
    scrypt as scryptCallback
} from "node:crypto";
import { promisify } from "node:util";
import { neon } from "@neondatabase/serverless";

const scrypt = promisify(scryptCallback);

export const SESSION_TTL_SECONDS = 8 * 60 * 60;
export const MAX_PROFILE_PICTURE_BYTES = 512 * 1024;
export const PASSWORD_HASH_BYTES = 64;
export const PASSWORD_SCRYPT_OPTIONS = {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024
};

let sqlClient;

export function sql() {
    if (!process.env.DATABASE_URL) {
        throw new Error("DATABASE_URL is not configured for this deployment.");
    }
    if (!sqlClient) sqlClient = neon(process.env.DATABASE_URL);
    return sqlClient;
}

export function json(statusCode, value, headers = {}) {
    return {
        statusCode,
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            ...headers
        },
        body: JSON.stringify(value)
    };
}

export function text(statusCode, value, headers = {}) {
    return {
        statusCode,
        headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            ...headers
        },
        body: value
    };
}

export function withErrors(handler) {
    return async (event, context) => {
        try {
            return await handler(event, context);
        } catch (error) {
            console.error("Netlify function request failed:", error);
            return json(error.statusCode || 500, {
                error: error.statusCode && error.statusCode < 500
                    ? error.message
                    : "The server could not complete the request."
            });
        }
    };
}

export function methodNotAllowed(allowed) {
    return json(405, { error: "Method not allowed." }, { Allow: allowed });
}

export function isSameOrigin(event) {
    const origin = event.headers?.origin;
    if (!origin) return true;

    try {
        const requestUrl = new URL(event.rawUrl);
        const expectedHost = event.headers?.["x-forwarded-host"] || requestUrl.host;
        return new URL(origin).host === expectedHost;
    } catch {
        return false;
    }
}

export function readJson(event, maxBytes = 4096) {
    if (!event.headers?.["content-type"]?.includes("application/json")) {
        throw Object.assign(new Error("JSON request body required."), {
            statusCode: 415
        });
    }

    if (!event.body) {
        throw Object.assign(new Error("Invalid JSON request body."), {
            statusCode: 400
        });
    }

    const body = event.isBase64Encoded
        ? Buffer.from(event.body, "base64").toString("utf8")
        : event.body;

    if (Buffer.byteLength(body, "utf8") > maxBytes) {
        throw Object.assign(new Error("Request body is too large."), {
            statusCode: 413
        });
    }

    try {
        const parsed = JSON.parse(body);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("A JSON object is required.");
        }
        return parsed;
    } catch (error) {
        if (error.message === "A JSON object is required.") {
            throw Object.assign(error, { statusCode: 400 });
        }
        throw Object.assign(new Error("Invalid JSON request body."), {
            statusCode: 400
        });
    }
}

function cookies(event) {
    const output = {};
    (event.headers?.cookie || "").split(";").forEach(cookie => {
        const separator = cookie.indexOf("=");
        if (separator < 0) return;
        output[cookie.slice(0, separator).trim()] =
            cookie.slice(separator + 1).trim();
    });
    return output;
}

function cookieOptions(event) {
    const url = new URL(event.rawUrl);
    const secure = url.protocol === "https:"
        || event.headers?.["x-forwarded-proto"] === "https";
    return `HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}${secure ? "; Secure" : ""}`;
}

export function clearSessionCookie(event) {
    const url = new URL(event.rawUrl);
    const secure = url.protocol === "https:"
        || event.headers?.["x-forwarded-proto"] === "https";
    return `drph_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure ? "; Secure" : ""}`;
}

function sessionTokenHash(token) {
    return createHash("sha256").update(token).digest("hex");
}

export async function issueSession(event, email) {
    const token = randomBytes(32).toString("base64url");
    const tokenHash = sessionTokenHash(token);
    const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
    const rows = await sql()`
        INSERT INTO auth_sessions (token_hash, user_id, expires_at)
        SELECT ${tokenHash}, id, ${expiresAt}
        FROM users
        WHERE LOWER(email) = ${email} AND status = 'active'
        RETURNING token_hash
    `;

    if (!rows.length) {
        throw new Error("Unable to create a session for this account.");
    }

    return json(200, { email }, {
        "Set-Cookie": `drph_session=${token}; ${cookieOptions(event)}`
    });
}

export async function getSession(event) {
    const token = cookies(event).drph_session;
    if (!token || token.length > 128) return null;

    const tokenHash = sessionTokenHash(token);
    const rows = await sql()`
        SELECT s.token_hash, u.id, u.email, u.role, u.status
        FROM auth_sessions AS s
        JOIN users AS u ON u.id = s.user_id
        WHERE s.token_hash = ${tokenHash}
            AND s.expires_at > NOW()
            AND u.status = 'active'
        LIMIT 1
    `;

    if (!rows.length) {
        await sql()`
            DELETE FROM auth_sessions
            WHERE token_hash = ${tokenHash}
                AND (
                    expires_at <= NOW()
                    OR NOT EXISTS (
                        SELECT 1
                        FROM users
                        WHERE users.id = auth_sessions.user_id
                            AND users.status = 'active'
                    )
                )
        `;
        return null;
    }

    return {
        tokenHash,
        id: rows[0].id,
        email: rows[0].email,
        role: rows[0].role
    };
}

export async function consumeAuthAttempt(event) {
    const address = event.headers?.["x-nf-client-connection-ip"]
        || event.headers?.["x-forwarded-for"]?.split(",")[0]?.trim()
        || "unknown";
    const key = createHash("sha256").update(address).digest("hex");
    const result = await sql()`
        SELECT consume_auth_attempt(${key}, 10, 900) AS allowed
    `;
    return Boolean(result[0]?.allowed);
}

export async function hashPassword(password, salt) {
    return scrypt(password, salt, PASSWORD_HASH_BYTES, PASSWORD_SCRYPT_OPTIONS);
}

export function passwordMatches(actualHash, expectedHex) {
    const expectedHash = Buffer.from(expectedHex, "hex");
    return expectedHash.length === actualHash.length
        && timingSafeEqual(actualHash, expectedHash);
}

export function isEmailValid(email) {
    return email.length >= 3
        && email.length <= 254
        && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function validateProfilePicture(dataUrl) {
    if (typeof dataUrl !== "string") {
        return { error: "Choose a PNG, JPEG, or WebP image." };
    }

    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
    if (!match) return { error: "Choose a PNG, JPEG, or WebP image." };

    const image = Buffer.from(match[2], "base64");
    if (
        !image.length
        || image.length > MAX_PROFILE_PICTURE_BYTES
        || image.toString("base64") !== match[2]
    ) {
        return { error: "The profile picture must be 512 KB or smaller." };
    }

    const isPng = image.length >= 8
        && image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const isJpeg = image.length >= 3
        && image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff;
    const isWebp = image.length >= 12
        && image.toString("ascii", 0, 4) === "RIFF"
        && image.toString("ascii", 8, 12) === "WEBP";
    const actualMime = isPng ? "image/png"
        : isJpeg ? "image/jpeg"
            : isWebp ? "image/webp"
                : null;

    if (actualMime !== `image/${match[1]}`) {
        return { error: "The selected file is not a valid PNG, JPEG, or WebP image." };
    }

    return { image, mimeType: actualMime };
}
