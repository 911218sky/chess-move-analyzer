#!/usr/bin/env node

const fsp = require("node:fs/promises");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const rootDir = path.resolve(__dirname, "..");
const jsOutDir = path.join(rootDir, "src", "js");

async function main() {
  await fsp.rm(jsOutDir, { recursive: true, force: true });

  if (process.platform === "win32") {
    execFileSync("cmd.exe", ["/d", "/s", "/c", "tsc -p tsconfig.json"], {
      cwd: rootDir,
      stdio: "inherit",
    });
    return;
  }

  execFileSync("tsc", ["-p", "tsconfig.json"], {
    cwd: rootDir,
    stdio: "inherit",
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
