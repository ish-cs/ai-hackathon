// One-off: unpack the Claude Design "standalone" bundle into real, editable files.
// Reads the bundle, writes fonts + video into web/assets/, and emits web/_design.html
// (the landing-page template) with all asset references rewritten to real paths.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const BUNDLE = process.argv[2];
const webDir = join(process.cwd(), "web");
const assetDir = join(webDir, "assets");
mkdirSync(assetDir, { recursive: true });

const h = readFileSync(BUNDLE, "utf8");
const manifest = JSON.parse(h.match(/<script type="__bundler\/manifest">([\s\S]*?)<\/script>/i)[1].trim());
let tpl = JSON.parse(h.match(/<script type="__bundler\/template">([\s\S]*?)<\/script>/i)[1].trim());

const ext = { "video/mp4": "mp4", "font/woff2": "woff2", "text/javascript": "js" };
const written = [];
for (const [id, v] of Object.entries(manifest)) {
  if (v.mime === "text/javascript") continue; // bundler runtime helper — not needed with real files
  const name = v.mime === "video/mp4" ? "demo.mp4" : `${id}.${ext[v.mime] || "bin"}`;
  writeFileSync(join(assetDir, name), Buffer.from(v.data, "base64"));
  // rewrite every reference to this id -> real path
  tpl = tpl.split(id).join(`assets/${name}`);
  written.push(`assets/${name} (${v.mime})`);
}

// Strip the bundler helper <script src="<jsId>"> tag(s)
tpl = tpl.replace(/<script[^>]*src="[0-9a-f-]{36}"[^>]*><\/script>/gi, "");

writeFileSync(join(webDir, "_design.html"), tpl);
console.log("wrote web/_design.html (" + tpl.length + " chars)");
console.log("assets:\n  " + written.join("\n  "));
