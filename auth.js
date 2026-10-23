"use strict";

const authForm = document.getElementById("auth-form");
const emailInput = document.getElementById("auth-email");
const passwordInput = document.getElementById("auth-password");
const message = document.getElementById("auth-message");
const title = document.getElementById("auth-title");
const description = document.getElementById("auth-description");
const submitButton = document.getElementById("auth-submit");
const passwordHint = document.getElementById("password-hint");
const loginButton = document.getElementById("show-login");
const registerButton = document.getElementById("show-register");
const togglePasswordButton = document.getElementById("toggle-password");

let mode = "login";

if (new URLSearchParams(window.location.search).get("deleted") === "1") {
    message.textContent = "Your account and profile picture have been permanently deleted.";
    message.classList.add("auth-message-success");
} else if (new URLSearchParams(window.location.search).get("server") === "unavailable") {
    message.textContent =
        "Unable to connect to the app service. Please try again in a moment.";
}

togglePasswordButton.addEventListener("click", () => {
    const isVisible = passwordInput.type === "text";
    passwordInput.type = isVisible ? "password" : "text";
    togglePasswordButton.textContent = isVisible ? "Show" : "Hide";
    togglePasswordButton.setAttribute(
        "aria-label",
        isVisible ? "Show password" : "Hide password"
    );
    togglePasswordButton.setAttribute("aria-pressed", String(!isVisible));
});

function setMode(nextMode) {
    mode = nextMode;
    const isRegistering = mode === "register";

    title.textContent = isRegistering ? "Create your account" : "Welcome back";
    description.textContent = isRegistering
        ? "Create an account to continue to your disaster readiness dashboard."
        : "Sign in to continue to your disaster readiness dashboard.";
    submitButton.textContent = isRegistering ? "Create account" : "Sign in";
    passwordInput.autocomplete = isRegistering ? "new-password" : "current-password";
    passwordHint.hidden = !isRegistering;
    passwordInput.type = "password";
    togglePasswordButton.textContent = "Show";
    togglePasswordButton.setAttribute("aria-label", "Show password");
    togglePasswordButton.setAttribute("aria-pressed", "false");
    loginButton.classList.toggle("active", !isRegistering);
    loginButton.setAttribute("aria-pressed", String(!isRegistering));
    registerButton.classList.toggle("active", isRegistering);
    registerButton.setAttribute("aria-pressed", String(isRegistering));
    message.textContent = "";
}

loginButton.addEventListener("click", () => setMode("login"));
registerButton.addEventListener("click", () => setMode("register"));

authForm.addEventListener("submit", async event => {
    event.preventDefault();
    message.textContent = "";
    submitButton.disabled = true;
    submitButton.textContent = mode === "register"
        ? "Creating account..."
        : "Signing in...";

    try {
        const response = await fetch(`/api/${mode}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({
                email: emailInput.value.trim(),
                password: passwordInput.value
            })
        });
        const result = await response.json();

        if (!response.ok) {
            message.textContent = result.error || "Unable to authenticate.";
            return;
        }

        window.location.assign("/");
    } catch {
        message.textContent =
            "Unable to connect to the app service. If this is a local install, " +
            "start it with start-app.bat. For a hosted site, try again later or " +
            "contact the site administrator.";
    } finally {
        submitButton.disabled = false;
        submitButton.textContent = mode === "register"
            ? "Create account"
            : "Sign in";
    }
});
