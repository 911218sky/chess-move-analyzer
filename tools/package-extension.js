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

  if (!["chrome", "firefox"].includes(target)) {
    throw new Error("Usage: node tools/package-extension.js <chrome|firefox> [version]");
  }

  const manifestVersion = normalizeManifestVersion(requestedVersion);
  const destinationDir = path.join(rootDir, "dist", "build", `chess-move-analyzer.${target}`);
  const archiveName =
    target === "chrome"
      ? `chess-move-analyzer_${requestedVersion}.chrome.zip`
      : `chess-move-analyzer_${requestedVersion}.firefox.xpi`;
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
  applyFirefoxUpdateSettings(manifest, target);

  await fsp.writeFile(
    path.join(destinationDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  if (shouldArchive) {
    await fsp.rm(archivePath, { force: true });
    await createZipArchive(destinationDir, archivePath);
  }

  if (target === "firefox" && shouldArchive) {
    await writeFirefoxUpdateManifest(manifestVersion);
    const stableFirefoxPath = path.join(rootDir, "dist", "build", "chess-move-analyzer.firefox.xpi");
    await fsp.copyFile(archivePath, stableFirefoxPath);
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

function applyFirefoxUpdateSettings(manifest, target) {
  if (target !== "firefox") {
    return;
  }

  const extensionId = process.env.FIREFOX_EXTENSION_ID;
  const updateUrl = process.env.FIREFOX_UPDATE_URL;

  if (!extensionId && !updateUrl) {
    return;
  }

  manifest.browser_specific_settings ??= {};
  manifest.browser_specific_settings.gecko ??= {};

  if (extensionId) {
    manifest.browser_specific_settings.gecko.id = extensionId;
  }

  if (updateUrl) {
    if (!manifest.browser_specific_settings.gecko.id) {
      throw new Error("FIREFOX_UPDATE_URL requires FIREFOX_EXTENSION_ID.");
    }
    manifest.browser_specific_settings.gecko.update_url = updateUrl;
  }
}

async function writeFirefoxUpdateManifest(version) {
  const extensionId = process.env.FIREFOX_EXTENSION_ID;
  const updateUrl = process.env.FIREFOX_UPDATE_URL;
  const xpiDownloadUrl = process.env.FIREFOX_XPI_DOWNLOAD_URL;

  if (!extensionId || !updateUrl || !xpiDownloadUrl) {
    return;
  }

  const updateManifest = {
    addons: {
      [extensionId]: {
        updates: [
          {
            version,
            update_link: xpiDownloadUrl,
          },
        ],
      },
    },
  };

  const updateManifestPath = path.join(rootDir, "dist", "build", "firefox-updates.json");
  await fsp.writeFile(updateManifestPath, `${JSON.stringify(updateManifest, null, 2)}\n`, "utf8");
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
