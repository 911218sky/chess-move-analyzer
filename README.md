# Chess Move Analyzer

Browser extension for Chess.com that combines Stockfish analysis with an
optional OpenAI-powered move explanation panel.

## Features

- Stockfish.js 18 Full NNUE and Lite engine modes
- Strength presets from fast time-based search to deep depth-based analysis
- Candidate line display with matching board highlights
- Live scoreboard with turn, evaluation, winning chances, best move, and move quality
- Move review tracking with centipawn loss, win chance swing, and session accuracy
- Chrome MV3 offscreen analysis support
- Firefox background analysis support
- Optional LLM explanation panel with configurable base URL, model, language, and prompt template

## Development

Install dependencies:

```bash
npm ci
```

The GitHub workflows use Node.js 22. Using the same major version locally will
avoid packaging drift.

Verify the TypeScript sources and compiled output:

```bash
npm run verify
```

If you only want a fast type check:

```bash
npm run check
```

## Build Packages

The official packaging entrypoint is `tools/package-extension.js`. The npm
scripts below compile TypeScript and copy Stockfish.js assets from the npm
`stockfish` package into unpacked extension folders. Large WASM files are not
committed to this repository.

```bash
npm run package:chrome
npm run package:firefox
```

Local output:

```text
dist/build/chess-move-analyzer.chrome
dist/build/chess-move-analyzer.firefox
```

To package release archives with an explicit version:

```bash
node tools/package-extension.js chrome v1.0.1 --archive
node tools/package-extension.js firefox v1.0.1 --archive
```

Archive output:

```text
dist/build/chess-move-analyzer_<version>.chrome.zip
dist/build/chess-move-analyzer_<version>.firefox.xpi
dist/build/chess-move-analyzer.firefox.xpi
```

## LLM Explanations

The options page can enable short natural-language explanations for the current
best move. When enabled, the extension stores these settings in local extension
storage:

- provider
- base URL
- API key
- model
- reply language
- prompt template

The default provider flow targets the OpenAI API, but the base URL is
configurable for compatible endpoints.

## Permissions

- `*://www.chess.com/*`: board state and move list observation
- `https://api.github.com/*`: latest release check in the popup
- `<all_urls>`: outbound requests to a user-configured OpenAI-compatible API endpoint

## Auto Update

Browser extensions do not self-update from in-extension code. The update path is
decided by the browser distribution channel:

- Chrome: publish to the Chrome Web Store if you want normal users to receive
  automatic updates.
- Firefox: publish to AMO, or self-host a signed XPI plus an update manifest.

This repository can generate Firefox self-update metadata during packaging when
these environment variables are set:

```bash
FIREFOX_EXTENSION_ID=chess-move-analyzer@example.com
FIREFOX_UPDATE_URL=https://github.com/<owner>/<repo>/releases/latest/download/firefox-updates.json
FIREFOX_XPI_DOWNLOAD_URL=https://github.com/<owner>/<repo>/releases/latest/download/chess-move-analyzer.firefox.xpi
```

When all three are present, the Firefox package includes
`browser_specific_settings.gecko.update_url` and writes
`dist/build/firefox-updates.json`.

## Release

GitHub Actions publishes releases from tags matching `v*.*.*`, or manually via
the `Release Extensions` workflow when you provide an explicit version such as
`v1.0.1`. Release assets are generated during the workflow, so `dist/`,
compiled `src/js/`, and Stockfish WASM assets are ignored by git.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the expected verification flow and
release version rules.

## License

This project is MIT licensed. Stockfish.js assets are GPLv3 and are fetched from
the npm `stockfish` package during builds.
