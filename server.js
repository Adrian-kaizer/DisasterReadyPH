"use strict";

const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { promisify } = require("node:util");
const { DatabaseSync } = require("node:sqlite");

const scrypt = promisify(crypto.scrypt);
const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 3000);
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 4096;
const MAX_PROFILE_PICTURE_BYTES = 512 * 1024;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX = 10;
const PASSWORD_HASH_BYTES = 64;
const PASSWORD_SCRYPT_OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const ROOT = __dirname;
const DATABASE_DIRECTORY = path.join(ROOT, "database");

fs.mkdirSync(DATABASE_DIRECTORY, { recursive: true });

const database = new DatabaseSync(path.join(DATABASE_DIRECTORY, "users.sqlite"));
database.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_salt TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user'
            CHECK (role IN ('user', 'admin')),
        status TEXT NOT NULL DEFAULT 'active'
            CHECK (status IN ('active', 'inactive')),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
`);

const userColumns = new Set(
    database.prepare("PRAGMA table_info(users)").all().map(column => column.name)
);
if (!userColumns.has("profile_picture")) {
    database.exec("ALTER TABLE users ADD COLUMN profile_picture BLOB");
}
if (!userColumns.has("profile_picture_mime")) {
    database.exec("ALTER TABLE users ADD COLUMN profile_picture_mime TEXT");
}
if (!userColumns.has("status")) {
    database.exec(
        "ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active' " +
        "CHECK (status IN ('active', 'inactive'))"
    );
}
if (!userColumns.has("role")) {
    database.exec(
        "ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user' " +
        "CHECK (role IN ('user', 'admin'))"
    );
}
database.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS one_admin_account " +
    "ON users (role) WHERE role = 'admin'"
);

const findUserByEmail = database.prepare(
    "SELECT id, email, password_salt, password_hash, role, status FROM users WHERE email = ?"
);
const findAccountStatusByEmail = database.prepare(
    "SELECT status FROM users WHERE email = ?"
);
const findProfileByEmail = database.prepare(
    "SELECT email, role, status, profile_picture, profile_picture_mime FROM users WHERE email = ?"
);
const updateProfilePicture = database.prepare(
    "UPDATE users SET profile_picture = ?, profile_picture_mime = ? WHERE email = ?"
);
const deleteUserByEmail = database.prepare("DELETE FROM users WHERE email = ?");
const createUser = database.prepare(
    "INSERT INTO users (email, password_salt, password_hash) VALUES (?, ?, ?)"
);

const sessions = new Map();
const authAttempts = new Map();
const locationSearchCache = new Map();
let nextLocationSearchAt = 0;
const staticFiles = new Map([
    ["/login.html", ["login.html", "text/html; charset=utf-8"]],
    ["/privacy.html", ["privacy.html", "text/html; charset=utf-8"]],
    ["/auth.js", ["auth.js", "text/javascript; charset=utf-8"]],
    ["/auth-guard.js", ["auth-guard.js", "text/javascript; charset=utf-8"]],
    ["/index.html", ["index.html", "text/html; charset=utf-8"]],
    ["/script.js", ["script.js", "text/javascript; charset=utf-8"]],
    ["/style.css", ["style.css", "text/css; charset=utf-8"]]
]);

function sendJson(response, statusCode, body, extraHeaders = {}) {
    response.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        ...extraHeaders
    });
    response.end(JSON.stringify(body));
}

function sendText(response, statusCode, message) {
    response.writeHead(statusCode, {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
    });
    response.end(message);
}

function readJson(request, maxBytes = MAX_BODY_BYTES) {
    return new Promise((resolve, reject) => {
        let body = "";
        let size = 0;
        let settled = false;

        request.on("data", chunk => {
            size += chunk.length;
            if (size > maxBytes) {
                settled = true;
                reject(Object.assign(new Error("Request body is too large."), {
                    statusCode: 413
                }));
                request.resume();
                return;
            }

            if (!settled) body += chunk.toString("utf8");
        });

        request.on("end", () => {
            if (settled) return;
            if (!request.headers["content-type"]?.includes("application/json")) {
                reject(Object.assign(new Error("JSON request body required."), {
                    statusCode: 415
                }));
                return;
            }

            try {
                resolve(JSON.parse(body));
            } catch {
                reject(Object.assign(new Error("Invalid JSON request body."), {
                    statusCode: 400
                }));
            }
        });

        request.on("error", error => {
            if (!settled) reject(error);
        });
    });
}

function parseCookies(request) {
    const cookies = {};
    (request.headers.cookie || "").split(";").forEach(cookie => {
        const separator = cookie.indexOf("=");
        if (separator < 0) return;
        const name = cookie.slice(0, separator).trim();
        const value = cookie.slice(separator + 1).trim();
        if (name) cookies[name] = value;
    });
    return cookies;
}

function getSession(request) {
    const token = parseCookies(request).drph_session;
    const session = token && sessions.get(token);

    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
        sessions.delete(token);
        return null;
    }

    const account = findAccountStatusByEmail.get(session.email);
    if (!account || account.status !== "active") {
        sessions.delete(token);
        return null;
    }

    return { token, ...session };
}

function sessionCookie(request, token) {
    const secure = request.socket.encrypted ? "; Secure" : "";
    return `drph_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_MS / 1000}${secure}`;
}

function clearSessionCookie(request) {
    const secure = request.socket.encrypted ? "; Secure" : "";
    return `drph_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
}

function isSameOrigin(request) {
    const origin = request.headers.origin;
    if (!origin) return true;

    try {
        return new URL(origin).host === request.headers.host;
    } catch {
        return false;
    }
}

function checkRateLimit(request) {
    const key = request.socket.remoteAddress || "unknown";
    const now = Date.now();
    const existing = authAttempts.get(key);
    const attempt = !existing || existing.resetAt <= now
        ? { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS }
        : existing;

    attempt.count++;
    authAttempts.set(key, attempt);
    return attempt.count <= RATE_LIMIT_MAX;
}

async function passwordHash(password, salt) {
    return scrypt(password, salt, PASSWORD_HASH_BYTES, PASSWORD_SCRYPT_OPTIONS);
}

async function handleAuth(request, response, route) {
    if (!isSameOrigin(request)) {
        sendJson(response, 403, { error: "Request origin not allowed." });
        return;
    }

    if (!checkRateLimit(request)) {
        sendJson(response, 429, {
            error: "Too many sign-in attempts. Please try again in 15 minutes."
        });
        return;
    }

    const body = await readJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
        sendJson(response, 400, { error: "A JSON object is required." });
        return;
    }

    const email = typeof body.email === "string"
        ? body.email.trim().toLowerCase()
        : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (
        email.length < 3 ||
        email.length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
        sendJson(response, 400, { error: "Enter a valid email address." });
        return;
    }

    if (route === "/api/register" && (password.length < 12 || password.length > 128)) {
        sendJson(response, 400, {
            error: "Use a password between 12 and 128 characters."
        });
        return;
    }

    if (!password || password.length > 128) {
        sendJson(response, 401, { error: "Email or password is incorrect." });
        return;
    }

    if (route === "/api/register") {
        const salt = crypto.randomBytes(16);
        const hash = await passwordHash(password, salt);

        try {
            createUser.run(email, salt.toString("hex"), hash.toString("hex"));
        } catch (error) {
            if (error.code === "ERR_SQLITE_ERROR" && /unique/i.test(error.message)) {
                sendJson(response, 409, {
                    error: "An account with that email already exists."
                });
                return;
            }
            throw error;
        }

        issueSession(request, response, email);
        return;
    }

    const user = findUserByEmail.get(email);
    const salt = user ? Buffer.from(user.password_salt, "hex") : Buffer.alloc(16);
    const expectedHash = user
        ? Buffer.from(user.password_hash, "hex")
        : Buffer.alloc(PASSWORD_HASH_BYTES);
    const actualHash = await passwordHash(password, salt);
    const passwordMatches = crypto.timingSafeEqual(actualHash, expectedHash);

    if (!user || !passwordMatches || user.status !== "active") {
        sendJson(response, 401, { error: "Email or password is incorrect." });
        return;
    }

    issueSession(request, response, user.email);
}

function issueSession(request, response, email) {
    const token = crypto.randomBytes(32).toString("base64url");
    const expiresAt = Date.now() + SESSION_TTL_MS;
    sessions.set(token, { email, expiresAt });

    sendJson(response, 200, { email }, {
        "Set-Cookie": sessionCookie(request, token)
    });
}

function detectProfilePictureMimeType(image) {
    const isPng = image.length >= 8 &&
        image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if (isPng) return "image/png";

    const isJpeg = image.length >= 3 &&
        image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff;
    if (isJpeg) return "image/jpeg";

    const isWebp = image.length >= 12 &&
        image.toString("ascii", 0, 4) === "RIFF" &&
        image.toString("ascii", 8, 12) === "WEBP";
    if (isWebp) return "image/webp";

    return null;
}

async function handleProfilePictureUpload(request, response, session) {
    if (!session) {
        sendJson(response, 401, { error: "Sign in to update your profile picture." });
        return;
    }
    if (!isSameOrigin(request)) {
        sendJson(response, 403, { error: "Request origin not allowed." });
        return;
    }

    const body = await readJson(request, Math.ceil(MAX_PROFILE_PICTURE_BYTES * 1.4));
    if (!body || typeof body.image !== "string") {
        sendJson(response, 400, { error: "Choose a PNG, JPEG, or WebP image." });
        return;
    }

    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(body.image);
    if (!match) {
        sendJson(response, 400, { error: "Choose a PNG, JPEG, or WebP image." });
        return;
    }

    const image = Buffer.from(match[2], "base64");
    if (
        !image.length ||
        image.length > MAX_PROFILE_PICTURE_BYTES ||
        image.toString("base64") !== match[2]
    ) {
        sendJson(response, 400, { error: "The profile picture must be 512 KB or smaller." });
        return;
    }

    const mimeType = detectProfilePictureMimeType(image);
    if (mimeType !== `image/${match[1]}`) {
        sendJson(response, 400, { error: "The selected file is not a valid PNG, JPEG, or WebP image." });
        return;
    }

    updateProfilePicture.run(image, mimeType, session.email);
    sendJson(response, 200, { ok: true });
}

async function handleLocationSearch(response, query) {
    const normalizedQuery = query.trim().replace(/\s+/g, " ");
    if (normalizedQuery.length < 2 || normalizedQuery.length > 120) {
        sendJson(response, 400, {
            error: "Enter a location between 2 and 120 characters."
        });
        return;
    }

    const cacheKey = normalizedQuery.toLocaleLowerCase();
    const cached = locationSearchCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
        sendJson(response, 200, cached.results);
        return;
    }

    const delay = Math.max(0, nextLocationSearchAt - Date.now());
    nextLocationSearchAt = Math.max(Date.now(), nextLocationSearchAt) + 1000;
    if (delay) {
        await new Promise(resolve => setTimeout(resolve, delay));
    }

    const searchUrl = new URL("https://nominatim.openstreetmap.org/search");
    searchUrl.searchParams.set("format", "jsonv2");
    searchUrl.searchParams.set("limit", "1");
    searchUrl.searchParams.set("countrycodes", "ph");
    searchUrl.searchParams.set("q", `${normalizedQuery}, Philippines`);

    let upstreamResponse;
    try {
        upstreamResponse = await fetch(searchUrl, {
            headers: {
                "User-Agent": "DisasterReadyPH/1.0 (evacuation map location search)"
            },
            signal: AbortSignal.timeout(8000)
        });
    } catch (error) {
        console.error("Location search provider request failed:", error);
        throw Object.assign(new Error("Location search is temporarily unavailable."), {
            statusCode: 502
        });
    }

    if (!upstreamResponse.ok) {
        console.error(`Location search provider returned HTTP ${upstreamResponse.status}.`);
        throw Object.assign(
            new Error(`Location search provider returned HTTP ${upstreamResponse.status}.`),
            { statusCode: 502 }
        );
    }

    let places;
    try {
        places = await upstreamResponse.json();
    } catch (error) {
        console.error("Location search provider returned invalid JSON:", error);
        throw Object.assign(new Error("Location search returned invalid data."), {
            statusCode: 502
        });
    }

    if (!Array.isArray(places)) {
        throw Object.assign(new Error("Location search returned invalid data."), {
            statusCode: 502
        });
    }

    const results = places.slice(0, 1).flatMap(place => {
        const latitude = Number(place.lat);
        const longitude = Number(place.lon);
        if (
            !Number.isFinite(latitude) ||
            latitude < -90 || latitude > 90 ||
            !Number.isFinite(longitude) ||
            longitude < -180 || longitude > 180 ||
            typeof place.display_name !== "string"
        ) {
            return [];
        }
        return [{
            latitude,
            longitude,
            displayName: place.display_name
        }];
    });

    if (locationSearchCache.size >= 500) {
        const oldestKey = locationSearchCache.keys().next().value;
        if (oldestKey !== undefined) locationSearchCache.delete(oldestKey);
    }
    locationSearchCache.set(cacheKey, {
        results,
        expiresAt: Date.now() + 30 * 60 * 1000
    });
    sendJson(response, 200, results);
}

function serveStatic(response, fileName, contentType) {
    const filePath = path.join(ROOT, fileName);
    fs.readFile(filePath, (error, contents) => {
        if (error) {
            console.error(`Unable to read ${fileName}:`, error);
            sendText(response, 500, "Unable to load the application.");
            return;
        }

        response.writeHead(200, {
            "Content-Type": contentType,
            "Cache-Control": contentType.startsWith("text/html")
                ? "no-store"
                : contentType.startsWith("text/javascript")
                    ? "no-store"
                    : "public, max-age=300",
            "X-Content-Type-Options": "nosniff",
            "X-Frame-Options": "DENY",
            "Referrer-Policy": "strict-origin-when-cross-origin"
        });
        response.end(contents);
    });
}

async function handleRequest(request, response) {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    const session = getSession(request);

    if (request.method === "GET" && url.pathname === "/api/location-search") {
        await handleLocationSearch(response, url.searchParams.get("q") || "");
        return;
    }

    if (request.method === "GET" && url.pathname === "/api/session") {
        sendJson(response, 200, session ? { authenticated: true, email: session.email } : {
            authenticated: false
        });
        return;
    }

    if (request.method === "GET" && url.pathname === "/api/profile") {
        if (!session) {
            sendJson(response, 401, { error: "Sign in to view your profile." });
            return;
        }

        const profile = findProfileByEmail.get(session.email);
        if (!profile) {
            sendJson(response, 401, { error: "The signed-in account was not found." });
            return;
        }

        sendJson(response, 200, {
            email: profile.email,
            role: profile.role,
            status: profile.status,
            hasProfilePicture: Boolean(profile.profile_picture)
        });
        return;
    }

    if (request.method === "GET" && url.pathname === "/api/profile-picture") {
        if (!session) {
            sendJson(response, 401, { error: "Sign in to view your profile picture." });
            return;
        }

        const profile = findProfileByEmail.get(session.email);
        if (!profile || !profile.profile_picture) {
            sendText(response, 404, "No profile picture.");
            return;
        }

        response.writeHead(200, {
            "Content-Type": profile.profile_picture_mime,
            "Content-Length": profile.profile_picture.length,
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; sandbox"
        });
        response.end(profile.profile_picture);
        return;
    }

    if (request.method === "POST" && url.pathname === "/api/profile-picture") {
        await handleProfilePictureUpload(request, response, session);
        return;
    }

    if (request.method === "POST" && url.pathname === "/api/delete-account") {
        if (!isSameOrigin(request)) {
            sendJson(response, 403, { error: "Request origin not allowed." });
            return;
        }
        if (!session) {
            sendJson(response, 401, { error: "Sign in again to delete your account." });
            return;
        }
        if (!checkRateLimit(request)) {
            sendJson(response, 429, {
                error: "Too many attempts. Please try again in 15 minutes."
            });
            return;
        }

        const body = await readJson(request);
        if (!body || typeof body !== "object" || Array.isArray(body)) {
            sendJson(response, 400, { error: "A JSON object is required." });
            return;
        }

        const password = typeof body.password === "string" ? body.password : "";
        if (!password || password.length > 128 || body.confirmation !== "DELETE") {
            sendJson(response, 400, {
                error: "Enter your password and type DELETE to confirm."
            });
            return;
        }

        const user = findUserByEmail.get(session.email);
        if (!user || user.status !== "active") {
            sessions.delete(session.token);
            sendJson(response, 401, { error: "Your account is no longer active." }, {
                "Set-Cookie": clearSessionCookie(request)
            });
            return;
        }

        const salt = Buffer.from(user.password_salt, "hex");
        const expectedHash = Buffer.from(user.password_hash, "hex");
        const actualHash = await passwordHash(password, salt);
        if (!crypto.timingSafeEqual(actualHash, expectedHash)) {
            sendJson(response, 401, { error: "The password is incorrect." });
            return;
        }

        const deletion = deleteUserByEmail.run(session.email);
        if (deletion.changes !== 1) {
            throw new Error("Expected to delete one account.");
        }

        for (const [token, activeSession] of sessions) {
            if (activeSession.email === session.email) sessions.delete(token);
        }

        sendJson(response, 200, { ok: true }, {
            "Set-Cookie": clearSessionCookie(request)
        });
        return;
    }

    if (
        request.method === "POST" &&
        (url.pathname === "/api/register" || url.pathname === "/api/login")
    ) {
        await handleAuth(request, response, url.pathname);
        return;
    }

    if (request.method === "POST" && url.pathname === "/api/logout") {
        if (!isSameOrigin(request)) {
            sendJson(response, 403, { error: "Request origin not allowed." });
            return;
        }

        if (session) sessions.delete(session.token);
        sendJson(response, 200, { ok: true }, {
            "Set-Cookie": clearSessionCookie(request)
        });
        return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
        sendText(response, 405, "Method not allowed.");
        return;
    }

    const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
    if (requestedPath === "/index.html" && !session) {
        response.writeHead(302, {
            Location: "/login.html",
            "Cache-Control": "no-store"
        });
        response.end();
        return;
    }

    if (requestedPath === "/login.html" && session) {
        response.writeHead(302, {
            Location: "/",
            "Cache-Control": "no-store"
        });
        response.end();
        return;
    }

    const file = staticFiles.get(requestedPath);
    if (!file) {
        sendText(response, 404, "Not found.");
        return;
    }

    serveStatic(response, file[0], file[1]);
}

async function start() {
    const server = http.createServer((request, response) => {
        handleRequest(request, response).catch(error => {
            console.error("Request failed:", error);
            if (!response.headersSent) {
                const statusCode = error.statusCode || 500;
                sendJson(response, statusCode, {
                    error: statusCode < 500
                        ? error.message
                        : "The server could not complete the request."
                });
            } else {
                response.destroy(error);
            }
        });
    });

    server.listen(PORT, HOST, () => {
        console.log(`DisasterReady PH is available on this computer at http://127.0.0.1:${PORT}`);
        for (const addresses of Object.values(os.networkInterfaces())) {
            for (const address of addresses || []) {
                if (address.family === "IPv4" && !address.internal) {
                    console.log(`Share on the same Wi-Fi/LAN: http://${address.address}:${PORT}`);
                }
            }
        }
        console.log("This HTTP demo is not suitable for public internet use or real passwords.");
        console.log(`User account database: ${path.join(DATABASE_DIRECTORY, "users.sqlite")}`);
    });
}

start().catch(error => {
    console.error("Unable to start the authentication server:", error);
    process.exitCode = 1;
});
