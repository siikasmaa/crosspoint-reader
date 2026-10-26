#!/usr/bin/env node
/**
 * Deploys the OTA worker with configuration taken from the environment.
 *
 * Loads `.env` from the repository root and from this directory (process
 * environment wins), then runs `wrangler deploy`, adding `--routes` when
 * OTA_ROUTE_PATTERN is set. wrangler itself picks up CLOUDFLARE_ACCOUNT_ID
 * and CLOUDFLARE_API_TOKEN from the environment.
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

function loadDotenv(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    let [key, ...rest] = line.split("=");
    key = key.trim().replace(/^export\s+/, "");
    let value = rest.join("=").trim();
    if (value.length >= 2 && value[0] === value.at(-1) && `"'`.includes(value[0])) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadDotenv(resolve(here, "../../.env"));
loadDotenv(resolve(here, ".env"));

const args = ["wrangler", "deploy", ...process.argv.slice(2)];
const route = process.env.OTA_ROUTE_PATTERN?.trim();
if (route) {
  args.push("--routes", route);
  console.log(`Deploying with custom route: ${route}`);
} else {
  console.log("Deploying to the default *.workers.dev URL (OTA_ROUTE_PATTERN not set)");
}

const result = spawnSync("npx", args, { cwd: here, stdio: "inherit", env: process.env });
process.exit(result.status ?? 1);
