import { Resvg } from "@resvg/resvg-js";
import { writeFileSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const popupB64 = readFileSync(join(root, "src/assets/popup.png")).toString("base64");

// YouTube thumbnail: 1280x720
const W = 1280, H = 720;

// Popup screenshot — right side, scaled to fit ~300w x ~600h area
const srcW = 720, srcH = 890;
const scale = Math.min(310 / srcW, 620 / srcH);
const dw = Math.round(srcW * scale), dh = Math.round(srcH * scale);
const ix = 880, iy = Math.round((H - dh) / 2);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
  width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1" gradientUnits="objectBoundingBox">
      <stop offset="0%"   stop-color="#111827"/>
      <stop offset="100%" stop-color="#0d1117"/>
    </linearGradient>
    <!-- Orange diagonal streak -->
    <linearGradient id="streak" x1="0" y1="0" x2="1" y2="1" gradientUnits="objectBoundingBox">
      <stop offset="0%"   stop-color="#ffa116" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#ffa116" stop-opacity="0"/>
    </linearGradient>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="10" stdDeviation="20" flood-color="#000" flood-opacity="0.6"/>
    </filter>
    <filter id="glow-text">
      <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur"/>
      <feComposite in="SourceGraphic" in2="blur" operator="over"/>
    </filter>
    <clipPath id="sc"><rect x="${ix}" y="${iy}" width="${dw}" height="${dh}" rx="8"/></clipPath>
  </defs>

  <!-- Background -->
  <rect width="${W}" height="${H}" fill="url(#bg)"/>

  <!-- Diagonal orange glow streak (top-left to bottom-right) -->
  <polygon points="0,0 700,0 400,${H} 0,${H}" fill="url(#streak)"/>

  <!-- Left orange accent bar -->
  <rect x="0" y="0" width="6" height="${H}" fill="#ffa116"/>

  <!-- Top orange thin bar -->
  <rect x="0" y="0" width="${W}" height="4" fill="#ffa116" opacity="0.6"/>

  <!-- Subtle dot grid -->
  ${Array.from({ length: 5 }, (_, r) =>
    Array.from({ length: 8 }, (_, c) =>
      `<circle cx="${60 + c * 60}" cy="${60 + r * 60}" r="1.6" fill="#fff" opacity="0.05"/>`
    ).join("")
  ).join("")}

  <!-- "LeetGit" brand — top left -->
  <text font-family="Arial,Helvetica,sans-serif" font-weight="800" font-size="30" y="56">
    <tspan x="28" fill="#ffa116">Leet</tspan><tspan fill="#ffffff">Git</tspan>
  </text>

  <!-- Main headline: LeetCode -->
  <text x="28" y="210"
        font-family="Arial,Helvetica,sans-serif" font-weight="900" font-size="100"
        fill="#ffa116" letter-spacing="-2">LeetCode</text>

  <!-- Arrow -->
  <text x="28" y="300"
        font-family="Arial,Helvetica,sans-serif" font-weight="900" font-size="80"
        fill="#ffffff" opacity="0.85">&#x2192; GitHub</text>

  <!-- Subheading: "Automatically." -->
  <text x="28" y="378"
        font-family="Arial,Helvetica,sans-serif" font-weight="800" font-size="54"
        fill="#ffffff" letter-spacing="-1">Automatically.</text>

  <!-- Orange divider -->
  <rect x="28" y="402" width="60" height="5" rx="3" fill="#ffa116"/>

  <!-- Feature lines -->
  <text x="28" y="448" font-family="Arial,Helvetica,sans-serif" font-size="26" fill="#9ca3af">Every submission. One commit. Zero effort.</text>

  <!-- Badge: "Free Chrome Extension" -->
  <rect x="28" y="488" width="252" height="44" rx="22" fill="#ffa116"/>
  <text x="154" y="516" text-anchor="middle"
        font-family="Arial,Helvetica,sans-serif" font-weight="800" font-size="17"
        fill="#111827">Free Chrome Extension</text>

  <!-- Popup screenshot — right side -->
  <image href="data:image/png;base64,${popupB64}"
         x="${ix}" y="${iy}" width="${dw}" height="${dh}"
         filter="url(#shadow)" clip-path="url(#sc)"
         preserveAspectRatio="xMidYMid meet"/>
</svg>`;

const png = new Resvg(svg, {
  fitTo: { mode: "original" },
  font: { loadSystemFonts: true },
}).render().asPng();

const out = join(root, "src/assets/youtube-thumbnail.png");
writeFileSync(out, png);
console.log(`Generated youtube-thumbnail.png  (${W}x${H})`);
