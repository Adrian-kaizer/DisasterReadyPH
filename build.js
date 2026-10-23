"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const output = path.join(root, "dist");
const publicFiles = [
    "index.html",
    "login.html",
    "privacy.html",
    "auth.js",
    "auth-guard.js",
    "script.js",
    "style.css"
];

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });

for (const file of publicFiles) {
    fs.copyFileSync(path.join(root, file), path.join(output, file));
}

console.log(`Built ${publicFiles.length} public files into dist.`);
