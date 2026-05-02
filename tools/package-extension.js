#!/usr/bin/env node

const fsp = require("node:fs/promises");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const rootDir = path.resolve(__dirname, "..");
const packageJson = require(path.join(rootDir, "package.json"));
const stockfishFiles = [
  "stockfish-18.js",
  "stockfish-18.wasm",
  "stockfish-18-single.js",
  "stockfish-18-single.wasm",
  "stockfish-18-lite.js",
  "stockfish-18-lite.wasm",
  "stockfish-18-lite-single.js",
  "stockfish-18-lite-single.wasm",
];

async function main() {
  const target = process.argv[2];
  const requestedVersion = process.argv[3] ?? packageJson.version;
  const shouldArchive = process.argv.includes("--archive");
  const archiveLabelIndex = process.argv.indexOf("--archive-label");
  const archiveLabel =
    archiveLabelIndex >= 0 ? process.argv[archiveLabelIndex + 1] ?? "" : "";

  if (!["chrome", "firefox"].includes(target)) {
    throw new Error("Usage: node tools/package-extension.js <chrome|firefox> [version]");
  }

  const manifestVersion = normalizeManifestVersion(requestedVersion);
  const destinationDir = path.join(rootDir, "dist", "build", `chess-move-analyzer.${target}`);
  const archiveSuffix = archiveLabel
    ? `${requestedVersion}_${normalizeArchiveLabel(archiveLabel)}`
    : requestedVersion;
  const archiveName =
    target === "chrome"
      ? `chess-move-analyzer_${archiveSuffix}.chrome.zip`
      : `chess-move-analyzer_${archiveSuffix}.firefox.xpi`;
  const archivePath = path.join(rootDir, "dist", "build", archiveName);

  if (process.platform === "win32") {
    execFileSync("cmd.exe", ["/d", "/s", "/c", "npm run build"], {
      cwd: rootDir,
      stdio: "inherit",
    });
  } else {
    execFileSync("npm", ["run", "build"], {
      cwd: rootDir,
      stdio: "inherit",
    });
  }

  await fsp.rm(destinationDir, { recursive: true, force: true });
  await fsp.mkdir(path.join(destinationDir, "js"), { recursive: true });
  await fsp.mkdir(path.join(destinationDir, "pub"), { recursive: true });
  await fsp.mkdir(path.join(destinationDir, "res"), { recursive: true });
  await fsp.mkdir(path.join(destinationDir, "stockfish"), { recursive: true });

  await copyDirectory(path.join(rootDir, "src", "js"), path.join(destinationDir, "js"));
  await copyDirectory(path.join(rootDir, "src", "pub"), path.join(destinationDir, "pub"));
  await copyDirectory(path.join(rootDir, "src", "res"), path.join(destinationDir, "res"));

  const stockfishSourceDir = path.join(rootDir, "node_modules", "stockfish", "src");
  for (const fileName of stockfishFiles) {
    await fsp.copyFile(
      path.join(stockfishSourceDir, fileName),
      path.join(destinationDir, "stockfish", fileName),
    );
  }

  const manifestPath = path.join(rootDir, "platform", target, "manifest.json");
  const manifest = JSON.parse(await fsp.readFile(manifestPath, "utf8"));
  manifest.version = manifestVersion;

  await fsp.writeFile(
    path.join(destinationDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  if (shouldArchive) {
    await fsp.rm(archivePath, { force: true });
    await createZipArchive(destinationDir, archivePath);
  }

  console.log(`Created ${path.relative(rootDir, destinationDir)}`);
  if (shouldArchive) {
    console.log(`Created ${path.relative(rootDir, archivePath)}`);
  }
}

function normalizeManifestVersion(version) {
  const normalized = version.startsWith("v") ? version.slice(1) : version;

  if (!/^\d+(?:\.\d+){0,3}$/.test(normalized)) {
    throw new Error(`Invalid extension version "${version}". Use digits and dots only.`);
  }

  return normalized;
}

function normalizeArchiveLabel(label) {
  const normalized = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!normalized) {
    throw new Error(`Invalid archive label "${label}".`);
  }

  return normalized;
}

async function copyDirectory(sourceDir, destinationDir) {
  await fsp.cp(sourceDir, destinationDir, { recursive: true });
}

async function createZipArchive(sourceDir, archivePath) {
  if (process.platform === "win32") {
    const escapedSource = sourceDir.replace(/'/g, "''");
    const tempArchivePath = archivePath.endsWith(".zip") ? archivePath : `${archivePath}.zip`;
    const escapedArchive = tempArchivePath.replace(/'/g, "''");
    const command = [
      "$ErrorActionPreference = 'Stop'",
      `Compress-Archive -Path '${escapedSource}\\*' -DestinationPath '${escapedArchive}' -CompressionLevel Optimal`,
    ].join("; ");

    execFileSync(
      "powershell",
      ["-NoProfile", "-Command", command],
      { cwd: rootDir, stdio: "inherit" },
    );

    if (tempArchivePath !== archivePath) {
      await fsp.rm(archivePath, { force: true });
      await fsp.rename(tempArchivePath, archivePath);
    }
    return;
  }

  execFileSync("zip", ["-rq", archivePath, "."], {
    cwd: sourceDir,
    stdio: "inherit",
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
