#!/usr/bin/env bash
# One-time setup for Ubuntu 22.04+. Safe to run again.
# It checks the system packages and never installs them itself (that needs sudo).
set -euo pipefail
cd "$(dirname "$0")/.."

fail() { echo "error: $*" >&2; exit 1; }

node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 20 || (a === 20 && b >= 19) ? 0 : 1)' 2>/dev/null \
  || fail "Node.js 20.19 or newer is required (found: $(node -v 2>/dev/null || echo none)). See README, step 1."

if ! command -v pnpm >/dev/null; then
  corepack enable 2>/dev/null || true
fi
command -v pnpm >/dev/null || fail "pnpm is missing. Run 'corepack enable' (or 'npm i -g pnpm'), then re-run this script."

command -v pdftoppm >/dev/null || fail "poppler-utils is missing. Run: sudo apt install poppler-utils"

python3 -m venv --help >/dev/null 2>&1 || fail "python3-venv is missing. Run: sudo apt install python3-venv"

[ -f .env ] || cp .env.example .env
chmod 600 .env

pnpm install

if [ ! -d .venv ]; then
  python3 -m venv .venv
fi
.venv/bin/pip install --quiet -r scripts/requirements.txt

echo
echo "Setup complete."
echo "Next:"
echo "  1. Put your Datalab key in .env:  DATALAB_API_KEY=..."
echo "  2. Start the app:                 pnpm dev   (then open http://localhost:3000)"
echo "  3. Process scans (optional):      .venv/bin/python scripts/extract.py --watch"
