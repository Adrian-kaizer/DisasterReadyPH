
"use strict";

// ==========================================
// DISASTERREADY PH - MAIN JAVASCRIPT
// ==========================================

// Mobile navigation
const menuButton = document.getElementById("menuButton");
const navigation = document.getElementById("navigation");

if (menuButton && navigation) {
    menuButton.addEventListener("click", () => {
        const isOpen = navigation.classList.toggle("open");
        menuButton.setAttribute("aria-expanded", String(isOpen));
    });

    navigation.querySelectorAll("a").forEach(link => {
        link.addEventListener("click", () => {
            navigation.classList.remove("open");
            menuButton.setAttribute("aria-expanded", "false");
        });
    });
}

const logoutButton = document.getElementById("logoutButton");

const profileEmail = document.getElementById("profileEmail");
const profileRole = document.getElementById("profileRole");
const profileInitials = document.getElementById("profileInitials");
const profilePicture = document.getElementById("profilePicture");
const profilePictureInput = document.getElementById("profilePictureInput");
const profilePictureStatus = document.getElementById("profilePictureStatus");

async function loadUserProfile() {
    try {
        const response = await fetch("/api/profile", {
            credentials: "same-origin"
        });
        const profile = await response.json();

        if (!response.ok) {
            throw new Error(profile.error || "Unable to load your account profile.");
        }

        profileEmail.textContent = profile.email;
        profileInitials.textContent = profile.email.charAt(0).toUpperCase();
        profileRole.hidden = profile.role !== "admin";

        if (profile.hasProfilePicture) {
            profilePicture.src = `/api/profile-picture?updated=${Date.now()}`;
            profilePicture.hidden = false;
            profileInitials.hidden = true;
        }
    } catch (error) {
        console.error("Unable to load profile:", error);
        profilePictureStatus.textContent = error.message;
    }
}

if (profilePictureInput) {
    loadUserProfile();

    profilePictureInput.addEventListener("change", async () => {
        const file = profilePictureInput.files[0];
        if (!file) return;

        const allowedTypes = ["image/png", "image/jpeg", "image/webp"];
        if (!allowedTypes.includes(file.type)) {
            profilePictureStatus.textContent = "Choose a PNG, JPEG, or WebP image.";
            profilePictureInput.value = "";
            return;
        }
        if (file.size > 512 * 1024) {
            profilePictureStatus.textContent = "The image must be 512 KB or smaller.";
            profilePictureInput.value = "";
            return;
        }

        profilePictureStatus.textContent = "Saving profile picture...";
        profilePictureInput.disabled = true;

        try {
            const image = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.addEventListener("load", () => resolve(reader.result));
                reader.addEventListener("error", () => {
                    reject(new Error("Unable to read the selected image."));
                });
                reader.readAsDataURL(file);
            });

            const response = await fetch("/api/profile-picture", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "same-origin",
                body: JSON.stringify({ image })
            });
            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || "Unable to save your profile picture.");
            }

            profilePicture.src = `/api/profile-picture?updated=${Date.now()}`;
            profilePicture.hidden = false;
            profileInitials.hidden = true;
            profilePictureStatus.textContent = "Profile picture updated.";
        } catch (error) {
            console.error("Unable to update profile picture:", error);
            profilePictureStatus.textContent = error.message;
        } finally {
            profilePictureInput.disabled = false;
            profilePictureInput.value = "";
        }
    });
}

const deleteAccountForm = document.getElementById("deleteAccountForm");

if (deleteAccountForm) {
    const deleteAccountMessage = document.getElementById("deleteAccountMessage");
    const deleteAccountButton = deleteAccountForm.querySelector("button[type='submit']");

    deleteAccountForm.addEventListener("submit", async event => {
        event.preventDefault();
        deleteAccountMessage.textContent = "";
        deleteAccountButton.disabled = true;
        deleteAccountButton.textContent = "Deleting account...";

        try {
            const response = await fetch("/api/delete-account", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "same-origin",
                body: JSON.stringify({
                    password: document.getElementById("deleteAccountPassword").value,
                    confirmation: document.getElementById("deleteAccountConfirmation").value
                })
            });
            const result = await response.json();

            if (!response.ok) {
                deleteAccountMessage.textContent =
                    result.error || "Unable to delete your account.";
                return;
            }

            window.location.assign("/login.html?deleted=1");
        } catch (error) {
            console.error("Unable to delete account:", error);
            deleteAccountMessage.textContent =
                "Unable to reach the server. Check your connection and try again.";
        } finally {
            deleteAccountButton.disabled = false;
            deleteAccountButton.textContent = "Delete my account";
        }
    });
}

if (logoutButton) {
    logoutButton.addEventListener("click", async () => {
        logoutButton.disabled = true;

        try {
            const response = await fetch("/api/logout", {
                method: "POST",
                credentials: "same-origin"
            });

            if (!response.ok) {
                throw new Error("Sign out failed. Please try again.");
            }

            window.location.assign("/login.html");
        } catch (error) {
            console.error("Unable to sign out:", error);
            alert(error.message || "Unable to sign out. Please try again.");
            logoutButton.disabled = false;
        }
    });
}

// Page navigation
const pageViews = document.querySelectorAll(".page-view");
let map;

function showPageForHash(hash, updateHistory) {
    const target = document.getElementById(decodeURIComponent(hash.slice(1)));
    const page = target && target.closest(".page-view");

    if (!page) return;

    pageViews.forEach(view => {
        const isActive = view === page;
        view.classList.toggle("active", isActive);
        view.setAttribute("aria-hidden", String(!isActive));
    });

    if (map && page.contains(map.getContainer())) {
        window.requestAnimationFrame(() => map.invalidateSize({ pan: false }));
    }

    navigation.querySelectorAll("a[href^='#']").forEach(link => {
        const isCurrent = link.hash === hash;
        if (isCurrent) link.setAttribute("aria-current", "page");
        else link.removeAttribute("aria-current");
    });

    if (updateHistory && window.location.hash !== hash) {
        window.history.pushState(null, "", hash);
    }
}

document.querySelectorAll("a[href^='#']").forEach(link => {
    link.addEventListener("click", event => {
        const hash = link.getAttribute("href");
        if (!hash || hash === "#") return;

        event.preventDefault();
        showPageForHash(hash, true);
        const target = document.getElementById(decodeURIComponent(hash.slice(1)));
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
});

window.addEventListener("popstate", () => {
    showPageForHash(window.location.hash || "#dashboard", false);
});

showPageForHash(window.location.hash || "#dashboard", false);

// ==========================================
// MAP SEARCH
// ==========================================

let mapMarker;

const mapMessage = document.getElementById("mapMessage");
const locationSearch = document.getElementById("locationSearch");
const searchButton = document.getElementById("searchButton");

if (document.getElementById("map") && window.L) {
    map = L.map("map").setView([12.8797, 121.7740], 5);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">' +
            'OpenStreetMap contributors</a>',
        maxZoom: 19
    }).addTo(map);

    const mapPage = document.getElementById("map").closest(".page-view");
    if (mapPage.classList.contains("active")) {
        window.requestAnimationFrame(() => map.invalidateSize({ pan: false }));
    }
}

if (searchButton) {
    searchButton.addEventListener("click", searchLocation);
}

if (locationSearch) {
    locationSearch.addEventListener("keydown", event => {
        if (event.key === "Enter") {
            event.preventDefault();
            searchLocation();
        }
    });
}

async function searchLocation() {
    const query = locationSearch.value.trim();

    if (!query) {
        mapMessage.textContent = "Please enter a city or barangay.";
        return;
    }

    if (!map) {
        mapMessage.textContent =
            "The map library did not load. Check your internet connection and try again.";
        return;
    }

    mapMessage.textContent = "Searching for location...";

    try {
        const response = await fetch(
            `/api/location-search?q=${encodeURIComponent(query)}`,
            { credentials: "same-origin" }
        );

        if (!response.ok) {
            const result = await response.json();
            throw new Error(result.error || "Location search failed.");
        }

        const results = await response.json();

        if (!results.length) {
            mapMessage.textContent = "Location not found. Try a nearby city or barangay.";
            return;
        }

        const latitude = results[0].latitude;
        const longitude = results[0].longitude;

        map.setView([latitude, longitude], 14);

        if (mapMarker) map.removeLayer(mapMarker);

        mapMarker = L.marker([latitude, longitude])
            .addTo(map)
            .bindPopup(results[0].displayName)
            .openPopup();

        mapMessage.textContent =
            "Map centered on " + results[0].displayName
            + ". This marker does not confirm an evacuation center.";

    } catch (error) {
        console.error("Unable to search map location:", error);
        mapMessage.textContent = error.message
            || "Unable to search right now. Check your internet connection and try again.";
    }
}

// ==========================================
// EMERGENCY CHECKLIST
// ==========================================

const checklistItems = document.querySelectorAll(
    '#checklistItems input[type="checkbox"]'
);
const progressText = document.getElementById("progress");
const progressBar = document.getElementById("progressBar");
const resetChecklistButton = document.getElementById("resetChecklist");

function loadChecklist() {
    let saved = {};

    try {
        saved = JSON.parse(localStorage.getItem("drphChecklist") || "{}");
    } catch {
        saved = {};
    }

    checklistItems.forEach(item => {
        item.checked = Boolean(saved[item.dataset.item]);
    });

    updateChecklist();
}

function updateChecklist() {
    const completed = [...checklistItems].filter(item => item.checked).length;
    const total = checklistItems.length;

    progressText.textContent = `${completed} of ${total} completed`;
    progressBar.style.width = total ? `${(completed / total) * 100}%` : "0%";

    const saved = {};

    checklistItems.forEach(item => {
        saved[item.dataset.item] = item.checked;
    });

    localStorage.setItem("drphChecklist", JSON.stringify(saved));
}

checklistItems.forEach(item => {
    item.addEventListener("change", updateChecklist);
});

resetChecklistButton.addEventListener("click", () => {
    checklistItems.forEach(item => {
        item.checked = false;
    });
    updateChecklist();
});

loadChecklist();

// ==========================================
// HAZARD REPORTS
// ==========================================

const hazardForm = document.getElementById("hazardForm");
const reportMessage = document.getElementById("reportMessage");
const reportsList = document.getElementById("reportsList");

function getHazardReports() {
    try {
        return JSON.parse(localStorage.getItem("drphReports") || "[]");
    } catch {
        return [];
    }
}

function renderHazardReports() {
    const reports = getHazardReports();
    reportsList.replaceChildren();

    if (reports.length === 0) {
        reportsList.textContent = "No hazard reports submitted yet.";
        return;
    }

    reports.slice().reverse().forEach(report => {
        const article = document.createElement("article");
        article.className = "report-entry";

        const title = document.createElement("h4");
        title.textContent = report.type + " — " + report.location;

        const description = document.createElement("p");
        description.textContent = report.description;

        const date = document.createElement("p");
        date.textContent = "Reported: " + report.date;

        const status = document.createElement("span");
        status.className = "report-status";
        status.textContent = "Unverified report";

        article.append(title, description, date, status);
        reportsList.appendChild(article);
    });
}

hazardForm.addEventListener("submit", event => {
    event.preventDefault();

    const location = document.getElementById("reporterLocation").value.trim();
    const type = document.getElementById("hazardType").value;
    const description = document.getElementById("hazardDescription").value.trim();

    if (!location || !type || !description) {
        reportMessage.textContent = "Please complete all fields.";
        return;
    }

    const reports = getHazardReports();

    reports.push({
        location,
        type,
        description,
        date: new Date().toLocaleString()
    });

    localStorage.setItem("drphReports", JSON.stringify(reports));
    hazardForm.reset();

    reportMessage.textContent =
        "Report saved in this browser. It has not been sent to emergency responders.";

    renderHazardReports();
});

renderHazardReports();

// ==========================================
// FLOOD MONITORING ASSISTANT
// ==========================================

const stationForm = document.getElementById("stationForm");
const stationList = document.getElementById("stationList");
const assistantMessage = document.getElementById("assistantMessage");

const stationCount = document.getElementById("stationCount");
const warningCount = document.getElementById("warningCount");
const criticalCount = document.getElementById("criticalCount");

const waterChart = document.getElementById("waterChart");
const chartContext = waterChart ? waterChart.getContext("2d") : null;

function getStations() {
    try {
        return JSON.parse(localStorage.getItem("drphStations") || "[]");
    } catch {
        return [];
    }
}

function saveStations(stations) {
    localStorage.setItem("drphStations", JSON.stringify(stations));
}

function getStationStatus(station) {
    if (station.waterLevel >= station.criticalLevel) {
        return {
            name: "CRITICAL",
            className: "status-critical"
        };
    }

    if (station.waterLevel >= station.warningLevel) {
        return {
            name: "WARNING",
            className: "status-warning"
        };
    }

    return {
        name: "NORMAL",
        className: "status-normal"
    };
}

function renderStations() {
    const stations = getStations();

    stationList.replaceChildren();

    let warnings = 0;
    let criticals = 0;

    stations.forEach(station => {
        const status = getStationStatus(station);

        if (status.name === "WARNING") warnings++;
        if (status.name === "CRITICAL") criticals++;

        const article = document.createElement("article");
        article.className = "report-entry";

        const title = document.createElement("h4");
        title.textContent = station.name;

        const location = document.createElement("p");
        location.textContent = "Location: " + station.location;

        const level = document.createElement("p");
        level.textContent =
            "Water height: " + station.waterLevel.toFixed(2) + " meters";

        const thresholds = document.createElement("p");
        thresholds.textContent =
            `Warning: ${station.warningLevel.toFixed(2)} m | `
            + `Critical: ${station.criticalLevel.toFixed(2)} m`;

        const badge = document.createElement("span");
        badge.className = "station-status " + status.className;
        badge.textContent = status.name;

        const updated = document.createElement("p");
        updated.textContent = "Last reading: " + station.updatedAt;

        const actions = document.createElement("div");
        actions.className = "station-actions";

        const updateButton = document.createElement("button");
        updateButton.type = "button";
        updateButton.textContent = "Update Reading";
        updateButton.addEventListener("click", () => {
            document.getElementById("stationName").value = station.name;
            document.getElementById("stationLocation").value = station.location;
            document.getElementById("waterLevel").value = station.waterLevel;
            document.getElementById("warningLevel").value = station.warningLevel;
            document.getElementById("criticalLevel").value = station.criticalLevel;

            document.getElementById("flood-monitor").scrollIntoView({
                behavior: "smooth"
            });
            document.getElementById("waterLevel").focus();
        });

        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.textContent = "Delete Station";
        deleteButton.addEventListener("click", () => {
            const remaining = getStations().filter(item => item.id !== station.id);
            saveStations(remaining);
            renderStations();
        });

        actions.append(updateButton, deleteButton);
        article.append(title, location, level, thresholds, badge, updated, actions);
        stationList.appendChild(article);
    });

    if (stations.length === 0) {
        stationList.textContent = "No stations added yet.";
    }

    stationCount.textContent = String(stations.length);
    warningCount.textContent = String(warnings);
    criticalCount.textContent = String(criticals);

    updateAssistant(stations);
    drawWaterChart(stations);
}

stationForm.addEventListener("submit", event => {
    event.preventDefault();

    const name = document.getElementById("stationName").value.trim();
    const location = document.getElementById("stationLocation").value.trim();
    const waterLevel = Number(document.getElementById("waterLevel").value);
    const warningLevel = Number(document.getElementById("warningLevel").value);
    const criticalLevel = Number(document.getElementById("criticalLevel").value);

    if (
        !name || !location ||
        !Number.isFinite(waterLevel) || waterLevel < 0 ||
        !Number.isFinite(warningLevel) || warningLevel <= 0 ||
        !Number.isFinite(criticalLevel) || criticalLevel <= warningLevel
    ) {
        assistantMessage.textContent =
            "Please check the form. Water height must be non-negative, "
            + "and the critical threshold must be greater than the warning threshold.";
        return;
    }

    const stations = getStations();
    const existingIndex = stations.findIndex(
        station => station.name.toLowerCase() === name.toLowerCase()
        && station.location.toLowerCase() === location.toLowerCase()
    );

    const previous = existingIndex >= 0 ? stations[existingIndex] : null;

    const readings = previous ? previous.readings : [];
    readings.push({
        level: waterLevel,
        time: new Date().toLocaleString()
    });

    const station = {
        id: previous ? previous.id : (
            Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
        ),
        name,
        location,
        waterLevel,
        warningLevel,
        criticalLevel,
        updatedAt: new Date().toLocaleString(),
        readings: readings.slice(-20)
    };

    if (existingIndex >= 0) {
        stations[existingIndex] = station;
    } else {
        stations.push(station);
    }

    saveStations(stations);
    stationForm.reset();

    document.getElementById("warningLevel").value = "1.50";
    document.getElementById("criticalLevel").value = "2.00";

    renderStations();
});

function updateAssistant(stations) {
    if (!stations.length) {
        assistantMessage.textContent =
            "No monitoring data yet. Add a station and enter a water-level reading.";
        return;
    }

    const criticalStations = stations.filter(
        station => getStationStatus(station).name === "CRITICAL"
    );

    const warningStations = stations.filter(
        station => getStationStatus(station).name === "WARNING"
    );

    if (criticalStations.length) {
        assistantMessage.textContent =
            "CRITICAL STATUS: " +
            criticalStations.map(station =>
                `${station.name} (${station.location})`
            ).join(", ") +
            " has reached or exceeded its configured critical threshold. "
            + "Verify the reading and follow official local emergency instructions.";
        return;
    }

    if (warningStations.length) {
        assistantMessage.textContent =
            "WARNING STATUS: " +
            warningStations.map(station =>
                `${station.name} (${station.location})`
            ).join(", ") +
            " has reached its configured warning threshold. "
            + "Check conditions and confirm information with local authorities.";
        return;
    }

    assistantMessage.textContent =
        "All recorded stations are below their configured warning thresholds. "
        + "This does not guarantee safety; continue checking official weather and flood advisories.";
}

function drawWaterChart(stations) {
    if (!chartContext || !waterChart) return;

    const width = waterChart.clientWidth || 600;
    const height = 220;
    const pixelRatio = window.devicePixelRatio || 1;

    waterChart.width = width * pixelRatio;
    waterChart.height = height * pixelRatio;
    chartContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    chartContext.clearRect(0, 0, width, height);

    const padding = { left: 48, right: 15, top: 20, bottom: 38 };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;

    chartContext.font = "12px Arial";
    chartContext.fillStyle = "#68788b";
    chartContext.strokeStyle = "#dce5ef";
    chartContext.lineWidth = 1;

    const readings = stations.flatMap(station =>
        (station.readings || []).map(reading => ({
            station: station.name,
            level: reading.level
        }))
    ).slice(-20);

    if (!readings.length) {
        chartContext.fillText("Water-level readings will appear here.", 15, 35);
        return;
    }

    const maxLevel = Math.max(1, ...readings.map(item => item.level)) * 1.15;

    for (let i = 0; i <= 4; i++) {
        const y = padding.top + (plotHeight * i / 4);
        const value = maxLevel * (1 - i / 4);

        chartContext.beginPath();
        chartContext.moveTo(padding.left, y);
        chartContext.lineTo(width - padding.right, y);
        chartContext.stroke();

        chartContext.fillText(value.toFixed(1) + " m", 4, y + 4);
    }

    chartContext.strokeStyle = "#2475c6";
    chartContext.lineWidth = 2;
    chartContext.beginPath();

    readings.forEach((reading, index) => {
        const x = readings.length === 1
            ? padding.left + plotWidth / 2
            : padding.left + plotWidth * index / (readings.length - 1);

        const y = padding.top + plotHeight * (1 - reading.level / maxLevel);

        if (index === 0) chartContext.moveTo(x, y);
        else chartContext.lineTo(x, y);
    });

    chartContext.stroke();

    readings.forEach((reading, index) => {
        const x = readings.length === 1
            ? padding.left + plotWidth / 2
            : padding.left + plotWidth * index / (readings.length - 1);

        const y = padding.top + plotHeight * (1 - reading.level / maxLevel);

        chartContext.fillStyle = "#2475c6";
        chartContext.beginPath();
        chartContext.arc(x, y, 4, 0, Math.PI * 2);
        chartContext.fill();
    });

    chartContext.fillStyle = "#68788b";
    chartContext.fillText("Latest recorded readings (up to 20)", padding.left, height - 10);
}

window.addEventListener("resize", () => drawWaterChart(getStations()));

renderStations();

// =====================================
// DISASTER READY PH - LIVE WEATHER
// =====================================

let weatherLatitude = 14.5995;
let weatherLongitude = 120.9842;
let weatherPlace = "Manila";
let weatherRefreshTimer;
let suggestionTimer;
let suggestionRequest;
let activeSuggestion = -1;

const weatherInput = document.getElementById("weather-location");
const weatherSearchForm = document.getElementById("weather-search-form");
const locationSuggestions = document.getElementById("location-suggestions");

function closeLocationSuggestions() {
    locationSuggestions.replaceChildren();
    locationSuggestions.hidden = true;
    weatherInput.setAttribute("aria-expanded", "false");
    weatherInput.removeAttribute("aria-activedescendant");
    activeSuggestion = -1;
}

function formatPlace(place) {
    return [place.name, place.admin1, place.country]
        .filter((part, index, parts) => part && parts.indexOf(part) === index)
        .join(", ");
}

function selectWeatherPlace(place) {
    weatherLatitude = place.latitude;
    weatherLongitude = place.longitude;
    weatherPlace = formatPlace(place);
    weatherInput.value = weatherPlace;
    closeLocationSuggestions();
    loadWeather();
}

function renderLocationSuggestions(places) {
    locationSuggestions.replaceChildren();
    activeSuggestion = -1;

    places.forEach((place, index) => {
        const option = document.createElement("button");
        option.type = "button";
        option.id = `location-option-${index}`;
        option.className = "location-suggestion";
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", "false");
        option.textContent = formatPlace(place);
        option.addEventListener("click", () => selectWeatherPlace(place));
        locationSuggestions.appendChild(option);
    });

    locationSuggestions.hidden = places.length === 0;
    weatherInput.setAttribute("aria-expanded", String(places.length > 0));
}

async function suggestWeatherLocations(query) {
    if (suggestionRequest) suggestionRequest.abort();
    suggestionRequest = new AbortController();

    try {
        const url =
            "https://geocoding-api.open-meteo.com/v1/search" +
            "?name=" + encodeURIComponent(query) +
            "&count=10&language=en&format=json";
        const response = await fetch(url, { signal: suggestionRequest.signal });

        if (!response.ok) throw new Error("Location suggestions are unavailable.");

        const data = await response.json();
        const places = (data.results || []).slice().sort((first, second) => {
            return Number(second.country_code === "PH")
                - Number(first.country_code === "PH");
        }).slice(0, 6);

        if (places.length) renderLocationSuggestions(places);
        else closeLocationSuggestions();
    } catch (error) {
        if (error.name !== "AbortError") {
            closeLocationSuggestions();
            document.getElementById("weather-alert").textContent =
                "Location suggestions couldn't be loaded. You can still search for a location.";
        }
    }
}

// Search for a city or municipality
async function searchWeatherLocation() {
    const location = weatherInput.value.trim();

    if (!location) {
        document.getElementById("weather-status").textContent =
            "Enter a location";
        return;
    }

    if (activeSuggestion >= 0) {
        locationSuggestions.children[activeSuggestion].click();
        return;
    }

    const status = document.getElementById("weather-status");
    status.textContent = "Searching...";

    try {
        const url =
            "https://geocoding-api.open-meteo.com/v1/search" +
            "?name=" + encodeURIComponent(location) +
            "&count=10&language=en&format=json";

        const response = await fetch(url);

        if (!response.ok) {
            throw new Error("Location search failed.");
        }

        const data = await response.json();

        if (!data.results || data.results.length === 0) {
            throw new Error("Location not found. Try another name.");
        }

        const place = data.results.find(item => item.country_code === "PH")
            || data.results[0];
        selectWeatherPlace(place);

    } catch (error) {
        status.textContent = "Search failed";
        document.getElementById("weather-alert").textContent =
            error.message || "Unable to search for this location.";
    }
}

// Retrieve current weather and precipitation forecast
async function loadWeather() {
    const status = document.getElementById("weather-status");
    const alertBox = document.getElementById("weather-alert");

    status.textContent = "Updating...";

    try {
        const url =
            "https://api.open-meteo.com/v1/forecast" +
            "?latitude=" + weatherLatitude +
            "&longitude=" + weatherLongitude +
            "&current=temperature_2m,relative_humidity_2m," +
            "precipitation,rain,showers,weather_code,wind_speed_10m" +
            "&hourly=precipitation_probability" +
            "&forecast_hours=1" +
            "&timezone=auto";

        const response = await fetch(url);

        if (!response.ok) {
            throw new Error("Weather service is unavailable.");
        }

        const data = await response.json();
        const current = data.current;

        if (!current) {
            throw new Error("Current weather data is unavailable.");
        }

        const temperature = current.temperature_2m;
        const rainfall = current.precipitation;
        const wind = current.wind_speed_10m;

        const probability =
            data.hourly &&
            data.hourly.precipitation_probability &&
            data.hourly.precipitation_probability.length
                ? data.hourly.precipitation_probability[0]
                : null;

        document.getElementById("location-name").textContent =
            "Weather in " + weatherPlace;

        document.getElementById("temperature").textContent =
            temperature ?? "--";

        document.getElementById("rainfall").textContent =
            rainfall ?? "--";

        document.getElementById("rain-probability").textContent =
            probability ?? "--";

        document.getElementById("wind-speed").textContent =
            wind ?? "--";

        document.getElementById("weather-updated").textContent =
            "Weather observation time: " +
            current.time.replace("T", " ") +
            " (local time)";

        status.textContent = "Weather updated";

        // These are weather-based advisories, not official flood warnings.
        alertBox.className = "weather-alert";

        const code = current.weather_code;
        const rain = Number(current.rain ?? current.precipitation ?? 0);
        const rainProbability = Number(probability ?? 0);
        const windSpeed = Number(wind ?? 0);

        if (
            windSpeed >= 60 ||
            rain >= 15 ||
            rainProbability >= 80
        ) {
            alertBox.classList.add("danger");
            alertBox.textContent =
                "HIGH WEATHER ALERT: Current weather data indicates " +
                "strong wind or potentially significant rainfall. " +
                "Monitor PAGASA and local disaster office advisories. " +
                "This is not an official warning.";
        } else if (
            code >= 51 ||
            rain > 0 ||
            rainProbability >= 50 ||
            windSpeed >= 30
        ) {
            alertBox.classList.add("warning");
            alertBox.textContent =
                "WEATHER ADVISORY: Rain or stronger wind may affect " +
                "your area. Monitor weather updates and avoid rivers " +
                "or flood-prone locations if conditions worsen.";
        } else {
            alertBox.textContent =
                "No significant weather trigger was detected by this " +
                "basic rule. Continue monitoring official forecasts. " +
                "This does not guarantee that your area is safe from flooding.";
        }

    } catch (error) {
        status.textContent = "Update failed";
        alertBox.className = "weather-alert warning";
        alertBox.textContent =
            "Unable to retrieve live weather. Check your internet " +
            "connection and try again. " + error.message;
    }
}

// Use the browser's location permission
function useMyLocation(silentFallback = false) {
    if (!navigator.geolocation) {
        statusUnavailable("Your browser does not support location detection.", silentFallback);
        return;
    }

    document.getElementById("weather-status").textContent = "Finding location...";

    navigator.geolocation.getCurrentPosition(
        async function(position) {
            weatherLatitude = position.coords.latitude;
            weatherLongitude = position.coords.longitude;
            weatherPlace = "Near your current location";
            weatherInput.value = weatherPlace;
            closeLocationSuggestions();
            await loadWeather();
        },
        function() {
            statusUnavailable(
                "Location access was not granted. Enter a city or municipality instead.",
                silentFallback
            );
        }
    );
}

function statusUnavailable(message, silentFallback) {
    document.getElementById("weather-status").textContent =
        silentFallback ? "Showing Manila" : "Location unavailable";

    if (silentFallback) {
        loadWeather();
    } else {
        document.getElementById("weather-alert").textContent = message;
    }
}

// Connect the buttons after the page loads
document.addEventListener("DOMContentLoaded", function() {
    weatherSearchForm.addEventListener("submit", event => {
        event.preventDefault();
        searchWeatherLocation();
    });

    weatherInput.addEventListener("input", () => {
        if (suggestionRequest) suggestionRequest.abort();
        window.clearTimeout(suggestionTimer);
        closeLocationSuggestions();

        const query = weatherInput.value.trim();
        if (query.length < 2) return;

        suggestionTimer = window.setTimeout(
            () => suggestWeatherLocations(query),
            300
        );
    });

    weatherInput.addEventListener("keydown", event => {
        const options = [...locationSuggestions.children];

        if (event.key === "ArrowDown" && options.length) {
            event.preventDefault();
            activeSuggestion = (activeSuggestion + 1) % options.length;
        } else if (event.key === "ArrowUp" && options.length) {
            event.preventDefault();
            activeSuggestion = activeSuggestion <= 0
                ? options.length - 1
                : activeSuggestion - 1;
        } else if (event.key === "Escape") {
            closeLocationSuggestions();
            return;
        } else {
            return;
        }

        options.forEach((option, index) => {
            const selected = index === activeSuggestion;
            option.setAttribute("aria-selected", String(selected));
            if (selected) {
                weatherInput.setAttribute("aria-activedescendant", option.id);
                option.scrollIntoView({ block: "nearest" });
            }
        });
    });

    document.addEventListener("click", event => {
        if (!event.target.closest(".location-input-wrap")) {
            closeLocationSuggestions();
        }
    });

    document.getElementById("use-location")
        .addEventListener("click", () => useMyLocation());

    // Refresh weather data every five minutes.
    weatherRefreshTimer = setInterval(loadWeather, 5 * 60 * 1000);

    useMyLocation(true);
});
