"use strict";

document.documentElement.classList.add("auth-pending");

function loadProtectedApp() {
    const appScript = document.createElement("script");
    appScript.src = "/script.js?v=20261023-leaflet";
    appScript.addEventListener("load", () => {
        document.documentElement.classList.remove("auth-pending");
    }, { once: true });
    appScript.addEventListener("error", () => {
        window.location.replace("/login.html?server=unavailable");
    }, { once: true });
    document.body.appendChild(appScript);
}

fetch("/api/session", { credentials: "same-origin", cache: "no-store" })
    .then(response => {
        if (!response.ok) throw new Error("The app server is unavailable.");
        return response.json();
    })
    .then(session => {
        if (!session.authenticated) {
            window.location.replace("/login.html");
            return;
        }
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", loadProtectedApp, { once: true });
        } else {
            loadProtectedApp();
        }
    })
    .catch(error => {
        console.error("Unable to verify the current session:", error);
        window.location.replace("/login.html?server=unavailable");
    });
