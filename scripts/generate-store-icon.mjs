import { Resvg } from "@resvg/resvg-js";
import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// 128x128 total — icon lives in the 96x96 center (16px transparent padding each side).
// All coordinates are scaled from the original 128x128 icon by 0.75, then offset +16.
// Orange background + white letterforms → works on both light and dark backgrounds.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <!-- 96x96 orange rounded square, centred with 16px transparent padding -->
  <rect x="16" y="16" width="96" height="96" rx="18" fill="#ffa116"/>

  <!-- L — white (vertical bar + horizontal foot) -->
  <rect x="25" y="40" width="11" height="48" rx="2" fill="#ffffff"/>
  <rect x="25" y="77" width="33" height="11" rx="2" fill="#ffffff"/>

  <!-- G — white arc with crossbar -->
  <path d="M 99 50 A 19 19 0 1 0 106 64 L 87 64"
        fill="none" stroke="#ffffff" stroke-width="11"
        stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const resvg = new Resvg(svg, { fitTo: { mode: "original" } });
const png = resvg.render().asPng();
writeFileSync(join(root, "icons", "store-icon.png"), png);
console.log("Generated icons/store-icon.png (128x128 with 16px transparent padding)");
