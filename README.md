# Chess Move Analyzer

Chess.com browser extension with Stockfish analysis and an optional LLM move explanation panel.

## What It Does

- analyzes the current board with Stockfish
- shows candidate moves and evaluation
- displays a live scoreboard while you play or review
- tracks move quality and review stats
- can generate short move explanations with an OpenAI-compatible API

## Tech Stack

- TypeScript
- Stockfish.js 18
- Chrome extension build
- Firefox extension build

## Requirements

- Node.js 22+
- npm

## Install

```bash
npm ci
```

## Verify

```bash
npm run verify
```

## Build

```bash
npm run package:chrome
npm run package:firefox
```

Build output:

```text
dist/build/chess-move-analyzer.chrome
dist/build/chess-move-analyzer.firefox
```

Archive build:

```bash
node tools/package-extension.js chrome v1.0.1 --archive
node tools/package-extension.js firefox v1.0.1 --archive
```

Archive output:

```text
dist/build/chess-move-analyzer_<version>.chrome.zip
dist/build/chess-move-analyzer_<version>.firefox.xpi
```

When CI builds a branch release, the archive name also includes the branch name.

## LLM Settings

The extension can store:

- provider
- base URL
- API key
- model
- reply language
- prompt template

## Permissions

- `*://www.chess.com/*` for board and move data
- `https://api.github.com/*` for release checks in the popup
- `<all_urls>` for requests to a user-configured API endpoint

## Release

GitHub Actions runs verification on pull requests and on pushes to any branch.
Release packaging also runs on pushes to any branch, and release archive names include the branch name.

## Credits

This project is based on [kenhendricks00/chess-move-analyzer](https://github.com/kenhendricks00/chess-move-analyzer). Thanks to the original author for the foundation.

## License

This project is licensed under the GNU Affero General Public License v3.0.
