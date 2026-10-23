import {
    json,
    methodNotAllowed,
    sql,
    withErrors
} from "./lib/shared.mjs";

async function delay(milliseconds) {
    if (milliseconds > 0) {
        await new Promise(resolve => setTimeout(resolve, milliseconds));
    }
}

export const handler = withErrors(async event => {
    if (event.httpMethod !== "GET") return methodNotAllowed("GET");

    const query = (event.queryStringParameters?.q || "").trim().replace(/\s+/g, " ");
    if (query.length < 2 || query.length > 120) {
        return json(400, { error: "Enter a location between 2 and 120 characters." });
    }

    const normalizedQuery = query.toLocaleLowerCase();
    const cached = await sql()`
        SELECT results
        FROM location_search_cache
        WHERE query = ${normalizedQuery}
            AND expires_at > NOW()
        LIMIT 1
    `;
    if (cached.length) return json(200, cached[0].results);

    const reserved = await sql()`SELECT reserve_location_search_slot() AS wait_ms`;
    await delay(Number(reserved[0]?.wait_ms || 0));

    const searchUrl = new URL("https://nominatim.openstreetmap.org/search");
    searchUrl.searchParams.set("format", "jsonv2");
    searchUrl.searchParams.set("limit", "1");
    searchUrl.searchParams.set("countrycodes", "ph");
    searchUrl.searchParams.set("q", `${query}, Philippines`);

    let response;
    try {
        response = await fetch(searchUrl, {
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

    if (!response.ok) {
        console.error(`Location search provider returned HTTP ${response.status}.`);
        throw Object.assign(new Error("Location search is temporarily unavailable."), {
            statusCode: 502
        });
    }

    const places = await response.json();
    if (!Array.isArray(places)) {
        throw Object.assign(new Error("Location search returned invalid data."), {
            statusCode: 502
        });
    }

    const results = places.slice(0, 1).flatMap(place => {
        const latitude = Number(place.lat);
        const longitude = Number(place.lon);
        if (
            !Number.isFinite(latitude) || latitude < -90 || latitude > 90
            || !Number.isFinite(longitude) || longitude < -180 || longitude > 180
            || typeof place.display_name !== "string"
        ) return [];

        return [{ latitude, longitude, displayName: place.display_name }];
    });

    await sql()`
        INSERT INTO location_search_cache (query, results, expires_at)
        VALUES (${normalizedQuery}, ${JSON.stringify(results)}::jsonb, NOW() + INTERVAL '30 minutes')
        ON CONFLICT (query) DO UPDATE
        SET results = EXCLUDED.results,
            expires_at = EXCLUDED.expires_at
    `;

    return json(200, results);
});
