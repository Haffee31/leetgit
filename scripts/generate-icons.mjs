import { Resvg } from "@resvg/resvg-js";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const svgPath = join(root, "icons", "icon.svg");
const svg = readFileSync(svgPath, "utf8");

const SIZES = [16, 32, 48, 128];

for (const size of SIZES) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: size }
  });
  const pngData = resvg.render().asPng();
  const outPath = join(root, "icons", `icon${size}.png`);
  writeFileSync(outPath, pngData);
  console.log(`Generated icons/icon${size}.png (${pngData.length} bytes)`);
}
