# DataAnnotator

[![Nuxt 4](https://img.shields.io/badge/Nuxt-4.5.2-00DC82?logo=nuxt.js)](https://nuxt.com/)
[![Vue 3](https://img.shields.io/badge/Vue-3.5-4FC08D?logo=vuedotjs)](https://vuejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![SQLite](https://img.shields.io/badge/SQLite-better--sqlite3-003B57?logo=sqlite)](https://sqlite.org/)
[![Python 3.10+](https://img.shields.io/badge/Python-3.10+-3776AB?logo=python)](https://python.org/)

A human-in-the-loop review console for multi-page registration forms. Physical forms are scanned to PDF, processed into structured JSON via the Datalab extraction API, queued into a local SQLite database, and presented in a side-by-side web console for human verification before final approval and CSV export.

---

## Table of Contents

- [Overview & Architecture](#overview--architecture)
- [Key Features](#key-features)
- [Requirements](#requirements)
- [Quick Start](#quick-start)
- [Configuration (.env)](#configuration-env)
- [Reading & Ingesting Scans](#reading--ingesting-scans)
- [Review Console Workflow](#review-console-workflow)
- [Database & Migrations](#database--migrations)
- [API Reference](#api-reference)
- [Project Layout](#project-layout)
- [Production Deployment](#production-deployment)
- [Troubleshooting](#troubleshooting)

---

## Overview & Architecture

DataAnnotator bridges the gap between automated OCR extraction and high-accuracy record keeping.

```text
  [ Physical Forms ]
          │
          ▼
   (Scanned PDFs)
          │
          ▼
  files/incoming/
          │
          │  scripts/extract.py (watches incoming dir, calls Datalab API)
          ▼
  files/processing/  ◄───  [ <uuid>.pdf  +  <uuid>.json ]
          │
          │  Nitro Watcher (server/plugins/watchIncoming.ts)
          ▼
  SQLite Database (.data/forms.db)
          │
          │  REST API (server/api/validation/*)
          ▼
  Web Review Console (Nuxt 4 + Vue 3)
   - Claim lease (prevents duplicate reviews)
   - High-res PDF preview side-by-side with form fields
   - Live field validation & quick dropdowns
   - Reviewer approves or flags form
          │
          ▼
  files/approved/  ──►  CSV Export (/api/validation/export)
```

---

## Key Features

- **Side-by-Side Review:** High-DPI rasterized PDF pages (`poppler-utils`) displayed right alongside editable form inputs.
- **Dual-Page & Multi-Person Hierarchy:** Supports complex household registration forms covering household metadata plus Person 1 (Head of Family) through Person 5.
- **Reviewer Claim System:** Built-in reviewer claiming leases prevent concurrent reviewer collisions, with automatic expiration timeouts if a review is abandoned.
- **Automated Pipeline:** `scripts/extract.py` automatically detects incoming scans, uses deterministic UUID5 hashing (based on PDF content) to avoid duplicate API calls, and files `.pdf` + `.json` pairs.
- **Live Queue & Performance Tracking:** Track total, under-validation, approved, and failed form counts in real time, along with per-reviewer approval tallies.
- **Clean Tabular CSV Export:** Exports approved data formatted per person (one row per family member) with UTF-8 BOM encoding for seamless Microsoft Excel compatibility.

---

## Requirements

Tested on **Ubuntu 22.04+** (and compatible Linux distributions):

| Tool | Minimum Version | Installation Command |
| --- | --- | --- |
| **Node.js** | `20.19` or newer (LTS recommended) | See Quick Start (nvm) |
| **pnpm** | `10` (pinned in `package.json`) | `corepack enable` |
| **poppler-utils** | Any (`pdftoppm` binary) | `sudo apt install poppler-utils` |
| **Python** | `3.10` or newer | `sudo apt install python3-venv` |
| **Build tools** | For `better-sqlite3` native compilation | `sudo apt install build-essential` |

---

## Quick Start

### 1. Install System Dependencies & Node

```bash
# Node.js 20.19+ (Ubuntu system apt packages may be older; nvm is recommended)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
source ~/.bashrc && nvm install 22 && nvm use 22

# System packages
sudo apt update && sudo apt install -y poppler-utils python3-venv build-essential
```

### 2. Clone & Run Setup

```bash
git clone https://github.com/harshil15999/DataAnnotator.git
cd DataAnnotator

# Run the automated setup script
./scripts/setup.sh
```

`scripts/setup.sh` will:
- Validate your Node, pnpm, python, and poppler versions.
- Initialize your `.env` configuration file from `.env.example` with secure permissions (`600`).
- Install Node dependencies using `pnpm`.
- Create a Python virtual environment (`.venv`) and install extraction dependencies.

### 3. Configure Your Datalab API Key

Edit `.env` and insert your Datalab API key (required to extract scans):

```bash
nano .env
# Set DATALAB_API_KEY=your_key_here
```

> **Note:** Get a key at [https://www.datalab.to](https://www.datalab.to). The Nuxt web console itself does not call Datalab; only `scripts/extract.py` requires this key.

### 4. Start the Application

```bash
# Start the Nuxt development server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Configuration (.env)

All configuration variables are managed in `.env` (created from `.env.example`). Every setting is optional except `DATALAB_API_KEY` for scan ingestion.

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATALAB_API_KEY` | *(None)* | API key for `scripts/extract.py`. Obtain from [datalab.to](https://www.datalab.to). |
| `REVIEWERS` | `Asha Rao,Ben Lee,Chen Wei` | Comma-separated list of reviewer names available in the console dropdown. |
| `QUEUE_DB_FILE` | `.data/forms.db` | Path to the SQLite database file. Created automatically on first start. |
| `QUEUE_INCOMING_DIR` | `files/incoming` | Directory watched for incoming scan PDFs. |
| `QUEUE_PROCESSED_DIR`| `files/processing`| Staging folder holding paired `<uuid>.pdf` and `<uuid>.json` awaiting review. |
| `QUEUE_APPROVED_DIR` | `files/approved` | Target directory where approved PDFs are archived. |
| `QUEUE_FAILED_DIR`   | `files/failed`   | Target directory for unparseable or failed PDFs. |
| `QUEUE_WATCH`        | `true`           | Enables or disables folder watching by the server plugin. |
| `QUEUE_POLL_MS`      | `3000`           | Folder polling frequency in milliseconds. |

### Security & Key Hygiene
- `.env` is git-ignored and set to permission `600`. Keep it private.
- Never commit API keys or paste them into issue trackers or PRs.
- If a key is accidentally exposed, immediately revoke and regenerate it at [datalab.to](https://www.datalab.to).

---

## Reading & Ingesting Scans

Scans should be PDF files of the registration form. Any filename is supported; the watcher computes a deterministic UUID from the content.

### Continuous Watch Mode
Leave this running in the background to automatically ingest scans as they are placed into `files/incoming/`:

```bash
.venv/bin/python scripts/extract.py --watch
```

### One-Shot Single File Mode
To process an individual PDF form directly:

```bash
.venv/bin/python scripts/extract.py path/to/Form12.pdf
```

### CLI Arguments for `extract.py`:

```text
options:
  -h, --help            Show this help message and exit
  --watch               Watch the incoming folder continuously
  --incoming INCOMING   Directory to watch (default: files/incoming)
  --processing DIR      Output directory for pdf+json pairs (default: files/processing)
  --failed FAILED       Directory for failed extractions (default: files/failed)
  --db DB               Path to SQLite DB for collision checks (default: .data/forms.db)
  --interval INTERVAL   Seconds between sweeps in --watch mode (default: 3)
```

---

## Review Console Workflow

1. **Select Identity:** The reviewer selects their name from the top bar dropdown (populated via `REVIEWERS`).
2. **Claim Form:** Clicking **Next** or loading the console requests the next unapproved form and places an exclusive lease claim on it.
3. **Inspect & Correct:**
   - Review Page 1 & Page 2 by switching tabs or zoom levels.
   - Use built-in dropdowns for standard values (e.g., Blood Group: `A+`, `B+`, etc., or Village presets).
   - Edit any discrepancies directly in the corresponding field.
4. **Approve:** Submitting approval commits the verified fields to SQLite, tags the record with the reviewer's name and timestamp, and moves the PDF to `files/approved/`.
5. **Export:** Click **Export All** to download a unified, UTF-8 BOM formatted CSV spreadsheet.

---

## Database & Migrations

DataAnnotator stores queues and records in SQLite (`.data/forms.db`) via `better-sqlite3`.

### Fresh Install
Nothing to do — the database and tables are created automatically on the first server launch.

### Upgrading an Existing Database
If you have an existing database without reviewer claim columns, run the migration script:

```bash
# 1. Back up your existing database
cp .data/forms.db .data/forms.db.bak

# 2. Apply the migration
sqlite3 .data/forms.db < scripts/migrations/001_reviewer_claims.sql
```

*(Note: If the columns already exist, SQLite will report `duplicate column name`, which is harmless.)*

---

## API Reference

The server runs on Nitro / Nuxt 4 server endpoints:

| Endpoint | Method | Description |
| --- | --- | --- |
| `/api/reviewers` | `GET` | Returns list of configured reviewer names. |
| `/api/validation/next` | `GET` | Fetches and claims the next available pending form. Accepts `?reviewer=<name>`. |
| `/api/validation/:id/approve` | `POST` | Submits finalized form values. Accepts `reviewer` in request body. |
| `/api/validation/:id/page/:n` | `GET` | Returns rasterized PNG preview of page `:n` (1 or 2) for form `:id`. |
| `/api/validation/stats` | `GET` | Returns counts by status (`under_validation`, `approved`, `failed`) and per-reviewer approvals. |
| `/api/validation/export` | `GET` | Generates and streams full approved CSV data with UTF-8 BOM. |

---

## Project Layout

```text
DataAnnotator/
├── app/
│   ├── app.vue                   # Application root shell
│   ├── assets/css/main.css       # Tailwind & custom console styles
│   └── components/
│       ├── AppMain.vue           # Main application view
│       └── OcrConsole.vue        # Side-by-side verification console
├── files/
│   ├── incoming/                 # Drop scanned PDFs here
│   ├── processing/               # Ingested PDF + JSON pairs
│   ├── approved/                 # Verified & approved PDFs
│   └── failed/                   # Errored extractions
├── scripts/
│   ├── extract.py                # Python scan reader & Datalab API client
│   ├── extract.json              # Datalab extraction schema
│   ├── setup.sh                  # One-time automated environment setup script
│   └── migrations/
│       └── 001_reviewer_claims.sql
├── server/
│   ├── api/                      # Nitro API route handlers
│   ├── assets/templates/         # HTML template for form structure
│   ├── plugins/                  # Background watcher (watchIncoming.ts, reviewers.ts)
│   └── utils/                    # DB access, PDF rasterization, schema, CSV formatting
├── .env.example                  # Environment configuration template
├── nuxt.config.ts                # Nuxt configuration
└── package.json                  # Dependencies & scripts
```

---

## Production Deployment

### Build

```bash
NUXT_TELEMETRY_DISABLED=1 pnpm build
```

### Run Server

```bash
# Serves on http://localhost:3000 by default
node --env-file=.env .output/server/index.mjs

# Custom port
PORT=8080 node --env-file=.env .output/server/index.mjs
```

---

## Troubleshooting

- **`pdftoppm: not found` or blank preview images:**
  Poppler utilities are missing. Install with:
  ```bash
  sudo apt install -y poppler-utils
  ```
- **`better-sqlite3` native build failure:**
  C++ compiler tools are missing. Install build essentials:
  ```bash
  sudo apt install -y build-essential
  pnpm install
  ```
- **`DATALAB_API_KEY not found in .env`:**
  Verify that `.env` exists in the project root (not inside `scripts/`) and contains `DATALAB_API_KEY=...`.
- **Reviewer names not appearing:**
  Check `REVIEWERS` in `.env`. Comma-separated names cannot contain special characters. Restart the server after editing.
- **Port already in use:**
  Change port by launching with `PORT=3001 pnpm dev`.
