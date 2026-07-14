import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { basename, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const version = process.env.GITHUB_REF_NAME || `v${packageJson.version}`;
const dist = resolve(root, "dist");
const stage = resolve(dist, `SkyblockGPT-${version}`);
const zipPath = resolve(dist, `SkyblockGPT-${version}.zip`);

rmSync(dist, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

const files = [
  ["src", "cloudflare-worker"],
  ["actions/hypixel-worker.openapi.json", "skyblock-gpt-unified-action.json"],
  ["actions/minecraft-username.openapi.json", "minecraft-username-action.json"],
  ["actions/skycofl.openapi.json", "skycofl-direct-action.json"],
  ["gpt/instructions.md", "gpt-instructions.md"],
  ["gpt/config.md", "gpt-config.md"],
  ["README.md", "README.md"],
];

for (const [source, destination] of files) {
  cpSync(resolve(root, source), resolve(stage, destination), { recursive: true });
}

try {
  execFileSync("zip", ["-q", "-r", zipPath, "."], { cwd: stage, stdio: "inherit" });
} catch {
  console.error("The zip command is required. Run this in WSL/Linux, or download the ZIP from a tagged GitHub release.");
  process.exit(1);
}

console.log(JSON.stringify({ success: true, file: basename(zipPath), included_files: files.length }));

