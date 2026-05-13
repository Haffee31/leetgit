import { Resvg } from "@resvg/resvg-js";
import { writeFileSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const popupB64    = readFileSync(join(root, "src/assets/popup.png")).toString("base64");
const floatingB64 = readFileSync(join(root, "src/assets/floating-modal.png")).toString("base64");

const W = 1280, H = 800;
const popupW = 300, popupH = Math.round(300 * 890 / 720);  // 371
const floatW = 264, floatH = Math.round(264 * 760 / 714);  // 281
const popupX = 558, popupY = Math.round((H - popupH) / 2); // 214
const floatX = 884, floatY = Math.round((H - floatH) / 2) + 36; // 295

const dotGrid = Array.from({ length: 6 }, (_, row) =>
  Array.from({ length: 8 }, (_, col) =>
    `<circle cx="${70 + col * 36}" cy="${80 + row * 36}" r="1.5" fill="#ffffff" opacity="0.07"/>`
  ).join("")
).join("");

const bullets = [
  ["One solve, one commit - zero effort",          370],
  ["Rich Markdown with runtime and memory stats",  420],
  ["Per-problem history table per file",           470],
  ["Pause, resume, and filter by outcome",         520],
  ["Smart duplicate detection built in",           570],
].map(([text, y]) => `
  <circle cx="82" cy="${y - 5}" r="5" fill="#ffa116" opacity="0.9"/>
  <text x="100" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="17" fill="#e6edf3">${text}</text>`
).join("");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
  width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1" gradientUnits="objectBoundingBox">
      <stop offset="0%"   stop-color="#1a1f35"/>
      <stop offset="100%" stop-color="#0d1117"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%"   stop-color="#ffa116" stop-opacity="0.12"/>
      <stop offset="100%" stop-color="#ffa116" stop-opacity="0"/>
    </radialGradient>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="8" stdDeviation="16" flood-color="#000000" flood-opacity="0.5"/>
    </filter>
  </defs>

  <!-- Background -->
  <rect width="${W}" height="${H}" fill="url(#bg)"/>

  <!-- Warm glow behind screenshots -->
  <ellipse cx="860" cy="400" rx="380" ry="320" fill="url(#glow)"/>

  <!-- Orange left accent bar -->
  <rect x="0" y="0" width="5" height="${H}" fill="#ffa116"/>

  <!-- Subtle dot-grid texture (top-left) -->
  ${dotGrid}

  <!-- Brand name -->
  <text font-family="Arial, Helvetica, sans-serif" font-weight="800" font-size="68" letter-spacing="-1">
    <tspan x="68" y="210" fill="#ffa116">Leet</tspan><tspan fill="#ffffff">Git</tspan>
  </text>

  <!-- Tagline -->
  <text x="70" y="258" font-family="Arial, Helvetica, sans-serif" font-size="20" fill="#8b949e">Automatically sync your LeetCode</text>
  <text x="70" y="284" font-family="Arial, Helvetica, sans-serif" font-size="20" fill="#8b949e">submissions to GitHub.</text>

  <!-- Orange divider -->
  <rect x="70" y="308" width="40" height="3" rx="2" fill="#ffa116"/>

  <!-- Feature bullets -->
  ${bullets}

  <!-- Footer line -->
  <text x="70" y="740" font-family="Arial, Helvetica, sans-serif" font-size="14" fill="#484f58">Free and open source - No accounts - Your GitHub, your data</text>

  <!-- Popup screenshot -->
  <image href="data:image/png;base64,${popupB64}"
         x="${popupX}" y="${popupY}" width="${popupW}" height="${popupH}"
         filter="url(#shadow)" preserveAspectRatio="xMidYMid meet"/>

  <!-- Floating modal screenshot -->
  <image href="data:image/png;base64,${floatingB64}"
         x="${floatX}" y="${floatY}" width="${floatW}" height="${floatH}"
         filter="url(#shadow)" preserveAspectRatio="xMidYMid meet"/>

  <!-- Screenshot labels -->
  <text x="${popupX + popupW / 2}" y="${popupY + popupH + 22}"
        text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="13" fill="#484f58">Extension popup</text>
  <text x="${floatX + floatW / 2}" y="${floatY + floatH + 22}"
        text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="13" fill="#484f58">Floating panel on LeetCode</text>
</svg>`;

const png = new Resvg(svg, {
  fitTo: { mode: "original" },
  font: { loadSystemFonts: true },
}).render().asPng();

const outPath = join(root, "src/assets/promo-1280x800.png");
writeFileSync(outPath, png);
console.log(`Generated ${outPath}`);
