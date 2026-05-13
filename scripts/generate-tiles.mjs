import { Resvg } from "@resvg/resvg-js";
import { writeFileSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const popupB64    = readFileSync(join(root, "src/assets/popup.png")).toString("base64");
const floatingB64 = readFileSync(join(root, "src/assets/floating-modal.png")).toString("base64");

const RESVG_OPTS = { fitTo: { mode: "original" }, font: { loadSystemFonts: true } };

// ─── Shared SVG helpers ────────────────────────────────────────────────────

function bg(w, h) {
  return `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1" gradientUnits="objectBoundingBox">
      <stop offset="0%"   stop-color="#1a1f35"/>
      <stop offset="100%" stop-color="#0d1117"/>
    </linearGradient>
    <radialGradient id="glow" cx="70%" cy="50%" r="45%">
      <stop offset="0%"   stop-color="#ffa116" stop-opacity="0.10"/>
      <stop offset="100%" stop-color="#ffa116" stop-opacity="0"/>
    </radialGradient>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="6" stdDeviation="12" flood-color="#000" flood-opacity="0.55"/>
    </filter>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  <rect width="${w}" height="${h}" fill="url(#glow)"/>
  <rect x="0" y="0" width="5" height="${h}" fill="#ffa116"/>`;
}

function dots(cols, rows, ox, oy, gap = 32) {
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) =>
      `<circle cx="${ox + c * gap}" cy="${oy + r * gap}" r="1.3" fill="#fff" opacity="0.06"/>`
    ).join("")
  ).join("");
}

function brand(x, y, size) {
  return `<text font-family="Arial,Helvetica,sans-serif" font-weight="800" font-size="${size}">
    <tspan x="${x}" y="${y}" fill="#ffa116">Leet</tspan><tspan fill="#ffffff">Git</tspan>
  </text>`;
}

function screenshot(b64, srcW, srcH, maxW, maxH, x, y, clip) {
  const scale = Math.min(maxW / srcW, maxH / srcH);
  const dw = Math.round(srcW * scale);
  const dh = Math.round(srcH * scale);
  const dx = x + Math.round((maxW - dw) / 2);
  const dy = y + Math.round((maxH - dh) / 2);
  const clipId = `clip-${clip}`;
  return {
    defs: `<clipPath id="${clipId}"><rect x="${dx}" y="${dy}" width="${dw}" height="${dh}" rx="5"/></clipPath>`,
    img:  `<image href="data:image/png;base64,${b64}"
             x="${dx}" y="${dy}" width="${dw}" height="${dh}"
             filter="url(#shadow)" clip-path="url(#${clipId})"
             preserveAspectRatio="xMidYMid meet"/>`,
  };
}

// ─── 1. Small promo tile — 440×280 ────────────────────────────────────────

function makeSmall() {
  const W = 440, H = 280;

  // Popup screenshot fits in right section (x=220, maxW=200, maxH=240)
  const sc = screenshot(popupB64, 720, 890, 190, 240, 228, 20, "sm");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
    width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <defs>${sc.defs}</defs>
    ${bg(W, H)}
    ${dots(4, 4, 26, 26, 30)}

    ${brand(22, 96, 34)}

    <text x="22" y="124" font-family="Arial,Helvetica,sans-serif" font-size="13" fill="#8b949e">Sync LeetCode to GitHub.</text>

    <rect x="22" y="140" width="28" height="3" rx="1" fill="#ffa116"/>

    <text x="22" y="170" font-family="Arial,Helvetica,sans-serif" font-size="13" fill="#e6edf3">One solve, one commit.</text>
    <text x="22" y="192" font-family="Arial,Helvetica,sans-serif" font-size="13" fill="#e6edf3">Zero effort required.</text>

    ${sc.img}
  </svg>`;

  return svg;
}

// ─── 2. Marquee promo tile — 1400×560 ─────────────────────────────────────

function makeMarquee() {
  const W = 1400, H = 560;

  // Left panel: 0–520px  |  Right panel: 520–1380px (860px wide)
  const RX = 520, RW = W - RX - 20, RH = H;

  // Popup: fits in left half of right panel
  const halfW = Math.round(RW / 2) - 16;
  const scP = screenshot(popupB64,    720, 890,  halfW, H - 60, RX,          30, "mq-p");
  const scF = screenshot(floatingB64, 714, 760,  halfW, H - 80, RX + halfW + 32, 60, "mq-f");

  const bullets = [
    ["One solve, one commit",        300],
    ["Rich Markdown with stats",     340],
    ["Per-problem history table",    380],
    ["Smart duplicate detection",    420],
  ];

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
    width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <defs>${scP.defs}${scF.defs}</defs>
    ${bg(W, H)}
    ${dots(5, 4, 30, 40, 34)}

    ${brand(32, 150, 60)}

    <text x="34" y="192" font-family="Arial,Helvetica,sans-serif" font-size="18" fill="#8b949e">Automatically sync your LeetCode</text>
    <text x="34" y="216" font-family="Arial,Helvetica,sans-serif" font-size="18" fill="#8b949e">submissions to GitHub.</text>

    <rect x="34" y="238" width="36" height="3" rx="2" fill="#ffa116"/>

    ${bullets.map(([text, y]) => `
    <circle cx="46" cy="${y - 4}" r="4.5" fill="#ffa116" opacity="0.9"/>
    <text x="62" y="${y}" font-family="Arial,Helvetica,sans-serif" font-size="16" fill="#e6edf3">${text}</text>`
    ).join("")}

    <text x="34" y="510" font-family="Arial,Helvetica,sans-serif" font-size="13" fill="#484f58">Free and open source - Your GitHub, your data</text>

    ${scP.img}
    ${scF.img}
  </svg>`;

  return svg;
}

// ─── Generate ──────────────────────────────────────────────────────────────

const tiles = [
  { name: "promo-small-440x280",    svg: makeSmall()   },
  { name: "promo-marquee-1400x560", svg: makeMarquee() },
];

for (const { name, svg } of tiles) {
  const png = new Resvg(svg, RESVG_OPTS).render().asPng();
  const out = join(root, "src/assets", `${name}.png`);
  writeFileSync(out, png);
  console.log(`Generated ${name}.png`);
}
