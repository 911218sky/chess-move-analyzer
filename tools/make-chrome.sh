#!/usr/bin/env bash

set -euo pipefail

VERSION="${1:-0.0.0}"

exec node tools/package-extension.js chrome "$VERSION" --archive
