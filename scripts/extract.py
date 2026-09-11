#!/usr/bin/env python3
"""Extract structured JSON from registration-form PDFs using Datalab's extraction API.

Two modes:

  1. One shot — read one PDF against a schema and write the JSON beside it.

         python extract.py family_form.pdf extract.json

  2. Watch — poll files/incoming/ for Form<N>.pdf / Form_<N>.pdf, extract each one
     against extract.json, then move the PDF and its JSON into files/processing/
     as a pair. Anything that fails goes to files/failed/.

         python extract.py --watch
"""

import argparse
import json
import os
import re
import sys
import time

import requests
from dotenv import load_dotenv

EXTRACT_URL = "https://www.datalab.to/api/v1/extract"

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

# --- Config. Every value is overridable by the matching CLI flag. ---------------

INCOMING_DIR = os.path.join(PROJECT_ROOT, "files/incoming")     # watched; drop forms here
PROCESSING_DIR = os.path.join(PROJECT_ROOT, "files/processing")  # the pdf + json pair lands here
FAILED_DIR = os.path.join(PROJECT_ROOT, "files/failed")          # rejected or errored; redrop to retry
SCHEMA_PATH = os.path.join(SCRIPT_DIR, "extract.json")           # the extraction schema watch mode uses

FORM_NAME_RE = re.compile(r"form_?(\d+)$", re.I)  # loosen to accept other filename shapes
POLL_INTERVAL_S = 3          # gap between status checks on one extraction
REQUEST_TIMEOUT_S = 600      # give up on one document after this long
WATCH_INTERVAL_S = 3         # gap between sweeps of the incoming folder in --watch


class ExtractionError(Exception):
    """The API refused the document, failed on it, or took too long."""


# --- The API call ---------------------------------------------------------------


def extract(pdf_path, schema, api_key):
    """Submit one PDF and poll until the extraction comes back."""
    headers = {"X-Api-Key": api_key}

    with open(pdf_path, "rb") as f:
        response = requests.post(
            EXTRACT_URL,
            headers=headers,
            files={"file": (os.path.basename(pdf_path), f, "application/pdf")},
            data={
                "page_schema": json.dumps(schema),
                "mode": "balanced",
                "extraction_mode": "balanced",
            },
            timeout=300,
        )

    response.raise_for_status()
    check_url = response.json()["request_check_url"]

    deadline = time.time() + REQUEST_TIMEOUT_S
    while True:
        if time.time() > deadline:
            raise ExtractionError(f"timed out after {REQUEST_TIMEOUT_S}s")
        time.sleep(POLL_INTERVAL_S)

        result = requests.get(check_url, headers=headers, timeout=60).json()
        status = result.get("status")
        if status == "complete":
            break
        if status == "failed" or result.get("success") is False:
            raise ExtractionError(result.get("error") or "extraction failed")
        print(f"  ... status={status}")

    return json.loads(result["extraction_schema_json"])


def load_schema(path):
    with open(path) as f:
        return json.load(f)


def resolve_api_key():
    """Read the key once, so a missing key fails before any file is touched."""
    load_dotenv(os.path.join(SCRIPT_DIR, ".env"))
    load_dotenv()  # falls back to a .env at the project root
    key = os.getenv("DATALAB_API_KEY")
    if not key:
        sys.exit("DATALAB_API_KEY not found in .env")
    return key


# --- Mode 1: one shot ------------------------------------------------------------


def run_once(pdf_path, schema_path):
    data = extract(pdf_path, load_schema(schema_path), resolve_api_key())

    output_path = os.path.splitext(os.path.basename(pdf_path))[0] + ".json"
    with open(output_path, "w") as f:
        json.dump(data, f, indent=2)

    print(json.dumps(data, indent=2))
    print(f"\nSaved to {output_path}")


# --- Mode 2: watch ---------------------------------------------------------------


def is_form_pdf(filename):
    """Form3.pdf and Form_3.pdf are forms; anything else in the folder is not."""
    stem, extension = os.path.splitext(filename)
    return extension.lower() == ".pdf" and FORM_NAME_RE.fullmatch(stem) is not None


def free_stem(directory, stem):
    """A stem free for BOTH .pdf and .json, so the pair never drifts apart."""
    candidate, suffix = stem, 1
    while any(
        os.path.exists(os.path.join(directory, candidate + ext))
        for ext in (".pdf", ".json")
    ):
        suffix += 1
        candidate = f"{stem} ({suffix})"
    return candidate


def move_to_failed(pdf_path):
    os.makedirs(FAILED_DIR, exist_ok=True)
    stem = os.path.splitext(os.path.basename(pdf_path))[0]
    target = os.path.join(FAILED_DIR, free_stem(FAILED_DIR, stem) + ".pdf")
    os.replace(pdf_path, target)
    return target


def process_one(pdf_path, schema, api_key):
    """Extract one form, then file the PDF and its JSON together."""
    filename = os.path.basename(pdf_path)
    print(f"[extract] reading {filename}")

    data = extract(pdf_path, schema, api_key)

    os.makedirs(PROCESSING_DIR, exist_ok=True)
    stem = free_stem(PROCESSING_DIR, os.path.splitext(filename)[0])
    pdf_target = os.path.join(PROCESSING_DIR, stem + ".pdf")
    json_target = os.path.join(PROCESSING_DIR, stem + ".json")

    # Write the JSON to a temp name first: a half-written file must never be
    # visible in the folder, and os.replace is atomic within a filesystem.
    temp_target = json_target + ".tmp"
    with open(temp_target, "w") as f:
        json.dump(data, f, indent=2)

    os.replace(pdf_path, pdf_target)
    os.replace(temp_target, json_target)

    # The pair is the deliverable, so say so rather than assuming it.
    missing = [p for p in (pdf_target, json_target) if not os.path.exists(p)]
    if missing:
        raise ExtractionError(f"filed incompletely, missing: {', '.join(missing)}")

    print(f"[extract] {filename}: {os.path.basename(pdf_target)} + {os.path.basename(json_target)}")


def settled(path, seen):
    """True once a file has stopped growing — a copy still in progress is not a form."""
    try:
        info = os.stat(path)
    except OSError:
        return False

    previous = seen.get(path)
    seen[path] = (info.st_size, info.st_mtime)
    return previous == seen[path] and info.st_size > 0


def sweep(schema, api_key, seen):
    """One pass over the incoming folder."""
    for filename in sorted(os.listdir(INCOMING_DIR)):
        path = os.path.join(INCOMING_DIR, filename)
        if not os.path.isfile(path) or not is_form_pdf(filename):
            continue
        if not settled(path, seen):
            continue

        seen.pop(path, None)
        try:
            process_one(path, schema, api_key)
        except Exception as error:  # one bad document must not end the sweep
            print(f"[extract] {filename}: failed — {error}", file=sys.stderr)
            try:
                print(f"[extract] {filename}: moved to {move_to_failed(path)}", file=sys.stderr)
            except OSError as move_error:
                print(f"[extract] {filename}: could not be moved — {move_error}", file=sys.stderr)


def run_watch(schema_path):
    api_key = resolve_api_key()
    schema = load_schema(schema_path)

    for directory in (INCOMING_DIR, PROCESSING_DIR, FAILED_DIR):
        os.makedirs(directory, exist_ok=True)

    print(f"[extract] watching {INCOMING_DIR} every {WATCH_INTERVAL_S}s (Ctrl-C to stop)")

    seen = {}  # sizes from the last sweep, so a file being copied in is left alone
    try:
        while True:
            try:
                sweep(schema, api_key, seen)
            except Exception as error:  # one bad sweep must not end the loop
                print(f"[extract] sweep failed: {error}", file=sys.stderr)
            time.sleep(WATCH_INTERVAL_S)
    except KeyboardInterrupt:
        print("\n[extract] stopped")


# --- CLI --------------------------------------------------------------------------


def main():
    parser = argparse.ArgumentParser(
        description="Extract structured JSON from registration forms via Datalab.",
    )
    parser.add_argument("pdf", nargs="?", help="the PDF to read (one-shot mode)")
    parser.add_argument("schema", nargs="?", help=f"schema to read it against (default: {SCHEMA_PATH})")
    parser.add_argument("--watch", action="store_true", help="watch the incoming folder instead")
    parser.add_argument("--incoming", help="folder to watch")
    parser.add_argument("--processing", help="folder the pdf + json pair is filed into")
    parser.add_argument("--failed", help="folder failures are moved to")
    parser.add_argument("--interval", type=float, help="seconds between sweeps in --watch")
    args = parser.parse_args()

    global INCOMING_DIR, PROCESSING_DIR, FAILED_DIR, WATCH_INTERVAL_S
    if args.incoming:
        INCOMING_DIR = os.path.abspath(args.incoming)
    if args.processing:
        PROCESSING_DIR = os.path.abspath(args.processing)
    if args.failed:
        FAILED_DIR = os.path.abspath(args.failed)
    if args.interval:
        WATCH_INTERVAL_S = args.interval

    schema_path = args.schema or SCHEMA_PATH

    if args.watch:
        if args.pdf:
            parser.error("--watch takes no PDF argument")
        run_watch(schema_path)
    elif args.pdf:
        run_once(args.pdf, schema_path)
    else:
        parser.error("give a PDF to read, or --watch to watch the incoming folder")


if __name__ == "__main__":
    main()
