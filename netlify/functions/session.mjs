import {
    getSession,
    json,
    methodNotAllowed,
    withErrors
} from "./lib/shared.mjs";

export const handler = withErrors(async event => {
    if (event.httpMethod !== "GET") return methodNotAllowed("GET");
    const session = await getSession(event);
    return json(200, session
        ? { authenticated: true, email: session.email, role: session.role }
        : { authenticated: false });
});
