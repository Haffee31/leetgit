import { Resvg } from "@resvg/resvg-js";
import { writeFileSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Canvas
const W = 1280, H = 800;

// Right panel available area (screenshots live here)
const PANEL_X = 400, PANEL_PAD = 28;
const PANEL_W = W - PANEL_X - PANEL_PAD; // 852
const PANEL_H = H - PANEL_PAD * 2;       // 744

const screens = [
  {
    file:  "setup-guide-step-1",
    badge: "Step 1 of 3",
    title: ["Pick a repository"],
    desc:  ["Choose where your LeetCode", "submissions will be committed."],
    out:   "promo-setup-step-1",
  },
  {
    file:  "setup-guide-step-2",
    badge: "Step 2 of 3",
    title: ["Generate an", "access token"],
    desc:  ["Create a fine-grained GitHub PAT", "with Contents read and write access."],
    out:   "promo-setup-step-2",
  },
  {
    file:  "setup-guide-step-3",
    badge: "Step 3 of 3",
    title: ["Connect LeetGit"],
    desc:  ["Paste your token, load repos,", "pick one, and save. Done."],
    out:   "promo-setup-step-3",
  },
  {
    file:  "options-1",
    badge: "Settings",
    title: ["Configure", "your setup"],
    desc:  ["Manage your token, repository,", "commit style, and more."],
    out:   "promo-settings",
  },
];

function getPngDims(buf) {
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

function makeSvg(imgB64, imgW, imgH, badge, titleLines, descLines) {
  // Scale screenshot to fit right panel
  const scale = Math.min(PANEL_W / imgW, PANEL_H / imgH);
  const dw = Math.round(imgW * scale);
  const dh = Math.round(imgH * scale);
  const ix = PANEL_X + PANEL_PAD + Math.round((PANEL_W - dw) / 2);
  // For very wide images (short display height) anchor to top with small padding;
  // otherwise centre vertically.
  const iy = dh < PANEL_H * 0.75
    ? Math.round(PANEL_PAD + (PANEL_H - dh) * 0.2)  // top-biased
    : PANEL_PAD + Math.round((PANEL_H - dh) / 2);   // centred

  // Badge pill (step badge or label)
  const isStep = badge.startsWith("Step");
  const badgeBg = isStep ? "#ffa116" : "#2db55d";

  // Left panel vertical centering — content block starts at ~200px
  const titleY  = titleLines.length > 1 ? 280 : 310;
  const descY0  = titleY + titleLines.length * 50 + 20;

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
  width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1" gradientUnits="objectBoundingBox">
      <stop offset="0%"   stop-color="#1a1f35"/>
      <stop offset="100%" stop-color="#0d1117"/>
    </linearGradient>
    <filter id="shadow" x="-8%" y="-8%" width="116%" height="116%">
      <feDropShadow dx="0" dy="6" stdDeviation="14" flood-color="#000000" flood-opacity="0.55"/>
    </filter>
    <clipPath id="screen-clip">
      <rect x="${ix}" y="${iy}" width="${dw}" height="${dh}" rx="6"/>
    </clipPath>
  </defs>

  <!-- Background -->
  <rect width="${W}" height="${H}" fill="url(#bg)"/>

  <!-- Orange left accent bar -->
  <rect x="0" y="0" width="5" height="${H}" fill="#ffa116"/>

  <!-- Subtle dot texture top-left -->
  ${Array.from({ length: 5 }, (_, row) =>
    Array.from({ length: 5 }, (_, col) =>
      `<circle cx="${52 + col * 34}" cy="${52 + row * 34}" r="1.4" fill="#ffffff" opacity="0.06"/>`
    ).join("")
  ).join("")}

  <!-- Brand name (top-left) -->
  <text font-family="Arial, Helvetica, sans-serif" font-weight="800" font-size="26" y="74">
    <tspan x="32" fill="#ffa116">Leet</tspan><tspan fill="#ffffff">Git</tspan>
  </text>

  <!-- Badge pill -->
  <rect x="32" y="200" width="${badge.length * 9 + 24}" height="32" rx="16" fill="${badgeBg}"/>
  <text x="${32 + badge.length * 4.5 + 12}" y="221"
        text-anchor="middle"
        font-family="Arial, Helvetica, sans-serif" font-size="13" font-weight="700" fill="#ffffff">${badge}</text>

  <!-- Title -->
  ${titleLines.map((line, i) => `
  <text x="32" y="${titleY + i * 52}"
        font-family="Arial, Helvetica, sans-serif" font-size="38" font-weight="800"
        fill="#ffffff">${line}</text>`).join("")}

  <!-- Orange divider -->
  <rect x="32" y="${descY0 - 8}" width="36" height="3" rx="2" fill="#ffa116"/>

  <!-- Description -->
  ${descLines.map((line, i) => `
  <text x="32" y="${descY0 + 26 + i * 30}"
        font-family="Arial, Helvetica, sans-serif" font-size="18" fill="#8b949e">${line}</text>`).join("")}

  <!-- Screenshot with shadow + rounded clip -->
  <image href="data:image/png;base64,${imgB64}"
         x="${ix}" y="${iy}" width="${dw}" height="${dh}"
         filter="url(#shadow)"
         clip-path="url(#screen-clip)"
         preserveAspectRatio="xMidYMid meet"/>
</svg>`;
}

for (const s of screens) {
  const buf   = readFileSync(join(root, "src/assets", `${s.file}.png`));
  const { w, h } = getPngDims(buf);
  const b64   = buf.toString("base64");

  const svg = makeSvg(b64, w, h, s.badge, s.title, s.desc);
  const png = new Resvg(svg, {
    fitTo: { mode: "original" },
    font:  { loadSystemFonts: true },
  }).render().asPng();

  const out = join(root, "src/assets", `${s.out}.png`);
  writeFileSync(out, png);
  console.log(`Generated ${s.out}.png  (screenshot: ${w}x${h} → displayed ${Math.round(Math.min(PANEL_W/w, PANEL_H/h) * w)}x${Math.round(Math.min(PANEL_W/w, PANEL_H/h) * h)})`);
}
