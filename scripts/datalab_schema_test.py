#!/usr/bin/env python3
"""
datalab_schema_test.py — standalone probe for Datalab's "Generate Extraction Schemas" API.

This script is intentionally self-contained: it imports nothing from the surrounding
application and writes only to its own output file. See README_datalab_schema_test.md
for the long-form explanation.

Quick start
-----------
    pip install requests
    echo 'DATALAB_API_KEY=dl_...' > .env
    python datalab_schema_test.py ./form.pdf

The API key is read from a .env file (searched next to this script, then the
current directory, then the parent project root) or from a real environment
variable. It is never hardcoded.

API sequence implemented (all documented at https://documentation.datalab.to):

    1. POST /api/v1/convert            multipart upload, save_checkpoint=true
                                       -> {request_id, request_check_url}
    2. GET  /api/v1/convert/{id}       poll until status == "complete"
                                       -> checkpoint_id
    3. POST /api/v1/marker/extraction/gen_schemas   json {"checkpoint_id": ...}
                                       -> {request_id, request_check_url}
    4. GET  /api/v1/marker/extraction/gen_schemas/{id}   poll until complete
                                       -> suggestions.{simple,moderate,complex}_schema

There is no separate "upload" or "confirm" endpoint in the Datalab API — the file
is posted directly as multipart/form-data to /api/v1/convert.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

try:
    import requests
except ImportError:  # pragma: no cover - dependency guard
    sys.exit("Missing dependency: requests. Install it with `pip install requests`.")


BASE_URL = "https://www.datalab.to/api/v1"
CONVERT_URL = f"{BASE_URL}/convert"
GEN_SCHEMAS_URL = f"{BASE_URL}/marker/extraction/gen_schemas"

API_KEY_ENV = "DATALAB_API_KEY"
DEFAULT_ENV_FILENAME = ".env"

# Datalab's docs recommend polling every ~2s. 3s is gentler and still responsive.
DEFAULT_POLL_INTERVAL = 3.0
DEFAULT_TIMEOUT = 600.0

MAX_FILE_BYTES = 200 * 1024 * 1024  # documented limit: 200 MB


class DatalabError(RuntimeError):
    """Any failure attributable to Datalab (HTTP, API-level, or timeout)."""


# --------------------------------------------------------------------------- #
# .env loading and credentials
# --------------------------------------------------------------------------- #


def parse_env_file(path: Path) -> dict[str, str]:
    """Parse a .env file into a dict, without depending on python-dotenv.

    Handles `KEY=value`, `export KEY=value`, comments, blank lines, and single-
    or double-quoted values. Malformed lines are skipped rather than fatal, so a
    stray line in a shared .env cannot break this script.
    """
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise DatalabError(f"Could not read env file {path}: {exc}")

    values: dict[str, str] = {}
    for line in raw.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export "):].strip()

        key, sep, value = line.partition("=")
        if not sep:
            continue
        key, value = key.strip(), value.strip()
        if not key:
            continue

        if value[:1] in ("'", '"'):
            # Quoted: take everything up to the matching close quote and drop
            # whatever follows (typically a trailing inline comment).
            quote = value[0]
            end = value.find(quote, 1)
            value = value[1:end] if end != -1 else value[1:]
        elif "#" in value:
            value = value.split("#", 1)[0].strip()  # trailing inline comment
        values[key] = value
    return values


def candidate_env_paths(explicit: str | None) -> list[Path]:
    """Where to look for a .env, nearest first."""
    if explicit:
        path = Path(explicit).expanduser()
        if not path.is_file():
            raise DatalabError(f"env file not found: {path}")
        return [path]

    script_dir = Path(__file__).resolve().parent
    return [
        script_dir / DEFAULT_ENV_FILENAME,          # scripts/.env
        Path.cwd() / DEFAULT_ENV_FILENAME,          # wherever you invoked it
        script_dir.parent / DEFAULT_ENV_FILENAME,   # project root
    ]


def load_env_files(explicit: str | None = None) -> list[Path]:
    """Load .env values into os.environ and return the files actually used.

    A real environment variable always wins over a .env entry (same rule as
    python-dotenv's default), so `DATALAB_API_KEY=... python datalab_schema_test.py`
    still overrides the file. Among files, the nearest one wins.
    """
    loaded: list[Path] = []
    seen: set[Path] = set()

    for path in candidate_env_paths(explicit):
        if not path.is_file():
            continue
        resolved = path.resolve()
        if resolved in seen:
            continue
        seen.add(resolved)

        entries = parse_env_file(path)
        for key, value in entries.items():
            os.environ.setdefault(key, value)
        if entries:
            loaded.append(path)

    return loaded


def read_api_key() -> str:
    key = os.environ.get(API_KEY_ENV, "").strip()
    if not key:
        raise DatalabError(
            f"{API_KEY_ENV} was not found in the environment or in any .env file.\n"
            f"  Get a key at https://www.datalab.to/app/keys, then add it to a .env\n"
            f"  file next to this script:\n"
            f"    echo '{API_KEY_ENV}=dl_your_key_here' >> "
            f"{Path(__file__).resolve().parent / DEFAULT_ENV_FILENAME}\n"
            f"  Make sure that .env is git-ignored before committing."
        )
    return key


# --------------------------------------------------------------------------- #
# Input validation
# --------------------------------------------------------------------------- #


def validate_pdf(path_str: str) -> Path:
    """Confirm the path exists and looks like a real, non-empty PDF."""
    path = Path(path_str).expanduser()

    if not path.exists():
        raise DatalabError(f"File does not exist: {path}")
    if not path.is_file():
        raise DatalabError(f"Not a regular file: {path}")

    size = path.stat().st_size
    if size == 0:
        raise DatalabError(f"File is empty: {path}")
    if size > MAX_FILE_BYTES:
        raise DatalabError(
            f"File is {size / 1e6:.1f} MB; Datalab's documented limit is 200 MB."
        )

    # Cheap structural sanity check — catches HTML error pages and truncated
    # downloads renamed to .pdf, without pulling in a PDF parsing dependency.
    with path.open("rb") as fh:
        header = fh.read(5)
    if path.suffix.lower() == ".pdf" and not header.startswith(b"%PDF-"):
        raise DatalabError(
            f"{path} does not start with the %PDF- magic bytes; it is not a valid PDF."
        )

    return path


# --------------------------------------------------------------------------- #
# HTTP helpers
# --------------------------------------------------------------------------- #


def parse_json(response: requests.Response, context: str) -> dict:
    try:
        payload = response.json()
    except ValueError:
        raise DatalabError(
            f"{context}: expected JSON but got HTTP {response.status_code} "
            f"with body: {response.text[:500]!r}"
        )
    if not isinstance(payload, dict):
        raise DatalabError(f"{context}: expected a JSON object, got {type(payload).__name__}")
    return payload


def check_http(response: requests.Response, context: str) -> dict:
    """Raise a readable DatalabError for non-2xx, otherwise return the parsed body."""
    if response.status_code == 401 or response.status_code == 403:
        raise DatalabError(f"{context}: authentication rejected (HTTP {response.status_code}). "
                           f"Check that {API_KEY_ENV} holds a valid key.")
    if response.status_code == 422:
        detail = parse_json(response, context).get("detail")
        raise DatalabError(f"{context}: request rejected as invalid (HTTP 422): "
                           f"{json.dumps(detail, indent=2) if detail else response.text[:500]}")
    if response.status_code == 429:
        raise DatalabError(f"{context}: rate limited (HTTP 429). Wait and retry.")
    if not response.ok:
        raise DatalabError(f"{context}: HTTP {response.status_code} — {response.text[:500]}")

    payload = parse_json(response, context)
    # Datalab reports API-level failures in the body even on HTTP 200.
    if payload.get("success") is False:
        raise DatalabError(f"{context}: {payload.get('error') or 'request failed with no error message'}")
    return payload


def poll_until_complete(
    session: requests.Session,
    check_url: str,
    *,
    context: str,
    interval: float,
    timeout: float,
) -> dict:
    """GET check_url on an interval until status is terminal, or raise on timeout."""
    deadline = time.monotonic() + timeout
    attempt = 0

    while True:
        if time.monotonic() >= deadline:
            raise DatalabError(
                f"{context}: timed out after {timeout:.0f}s waiting for completion. "
                f"Re-run with --timeout to allow longer, or check {check_url}"
            )

        attempt += 1
        try:
            response = session.get(check_url, timeout=60)
        except requests.RequestException as exc:
            raise DatalabError(f"{context}: network error while polling — {exc}")

        # A transient 429/5xx during polling is worth riding out rather than aborting.
        if response.status_code == 429 or response.status_code >= 500:
            time.sleep(min(interval * 2, 15.0))
            continue

        payload = check_http(response, context)
        status = payload.get("status")

        if status == "complete":
            return payload
        if status == "failed" or payload.get("success") is False:
            raise DatalabError(f"{context}: {payload.get('error') or 'processing failed'}")

        print(f"  ... status={status or 'unknown'} (poll #{attempt})", flush=True)
        time.sleep(interval)


# --------------------------------------------------------------------------- #
# Step 1 + 2: upload/convert, then wait for the checkpoint
# --------------------------------------------------------------------------- #


def convert_and_get_checkpoint(
    session: requests.Session,
    pdf_path: Path,
    *,
    mode: str,
    interval: float,
    timeout: float,
) -> str:
    print("Uploading PDF...", flush=True)

    with pdf_path.open("rb") as fh:
        try:
            response = session.post(
                CONVERT_URL,
                files={"file": (pdf_path.name, fh, "application/pdf")},
                # save_checkpoint is what makes the parsed document reusable; without
                # it the response carries no checkpoint_id and gen_schemas has no input.
                data={
                    "save_checkpoint": "true",
                    "output_format": "markdown",
                    "mode": mode,
                },
                timeout=300,
            )
        except requests.RequestException as exc:
            raise DatalabError(f"Upload failed: {exc}")

    submission = check_http(response, "Upload/convert")
    print("PDF uploaded.", flush=True)

    check_url = submission.get("request_check_url")
    if not check_url:
        raise DatalabError(f"Upload/convert: response contained no request_check_url: {submission}")
    print(f"Convert request ID: {submission.get('request_id')}", flush=True)

    print("Processing PDF...", flush=True)
    result = poll_until_complete(
        session, check_url, context="PDF processing", interval=interval, timeout=timeout
    )

    checkpoint_id = result.get("checkpoint_id")
    if not checkpoint_id:
        raise DatalabError(
            "PDF processing completed but returned no checkpoint_id. "
            "This usually means save_checkpoint was not honored for this request."
        )

    print(f"checkpoint_id: {checkpoint_id}", flush=True)
    if result.get("page_count") is not None:
        print(f"Pages processed: {result['page_count']}", flush=True)
    return checkpoint_id


# --------------------------------------------------------------------------- #
# Step 3 + 4: generate schemas from the checkpoint
# --------------------------------------------------------------------------- #


def generate_schemas(
    session: requests.Session,
    checkpoint_id: str,
    *,
    interval: float,
    timeout: float,
) -> dict:
    print("Generating extraction schemas...", flush=True)

    try:
        response = session.post(
            GEN_SCHEMAS_URL,
            json={"checkpoint_id": checkpoint_id},
            timeout=120,
        )
    except requests.RequestException as exc:
        raise DatalabError(f"Schema generation request failed: {exc}")

    submission = check_http(response, "Schema generation")
    request_id = submission.get("request_id")
    check_url = submission.get("request_check_url") or f"{GEN_SCHEMAS_URL}/{request_id}"
    if not request_id and not submission.get("request_check_url"):
        raise DatalabError(f"Schema generation: response had no request_id: {submission}")

    print(f"Request ID: {request_id}", flush=True)
    print("Waiting for schema generation...", flush=True)

    result = poll_until_complete(
        session, check_url, context="Schema generation", interval=interval, timeout=timeout
    )
    print("Schema generation completed.", flush=True)
    return resolve_suggestions(session, result)


def resolve_suggestions(session: requests.Session, result: dict) -> dict:
    """Return the completed result, following result_url when suggestions are offloaded.

    For large results Datalab returns a signed result_url instead of inlining the
    payload. The signed URL carries its own credentials, so it is fetched without
    the API-key header.
    """
    if result.get("suggestions"):
        return result

    result_url = result.get("result_url")
    if not result_url:
        raise DatalabError(
            "Schema generation completed but returned neither suggestions nor a result_url."
        )

    print("Suggestions delivered via signed result_url; downloading...", flush=True)
    try:
        response = requests.get(result_url, timeout=120)
    except requests.RequestException as exc:
        raise DatalabError(f"Failed to download result_url: {exc}")

    downloaded = check_http(response, "Result download")
    if not downloaded.get("suggestions"):
        raise DatalabError("Downloaded result contained no suggestions.")

    merged = dict(result)
    merged.update(downloaded)
    return merged


def decode_suggestions(suggestions: dict) -> dict:
    """Turn the three JSON-encoded schema strings into real objects.

    Datalab returns simple_schema / moderate_schema / complex_schema as strings
    containing JSON Schema. A string that does not parse is kept verbatim rather
    than dropped, so nothing is silently lost.
    """
    decoded: dict[str, object] = {}
    for level in ("simple_schema", "moderate_schema", "complex_schema"):
        raw = suggestions.get(level)
        if raw is None:
            continue
        if isinstance(raw, str):
            try:
                decoded[level] = json.loads(raw)
            except json.JSONDecodeError:
                decoded[level] = {"_unparsed_raw": raw}
        else:
            decoded[level] = raw
    if not decoded:
        raise DatalabError("Schema generation returned an empty suggestions object.")
    return decoded


# --------------------------------------------------------------------------- #
# Entry point
# --------------------------------------------------------------------------- #


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Generate Datalab extraction schemas from a local PDF.",
        epilog=f"Reads {API_KEY_ENV} from a .env file or the environment.",
    )
    parser.add_argument("pdf", help="Path to the local PDF file")
    parser.add_argument(
        "--env-file", default=None,
        help="Explicit path to a .env file (default: search .env next to this "
             "script, then the current directory, then the project root)",
    )
    parser.add_argument(
        "-o", "--output", default="generated_schemas.json",
        help="Where to write the generated schemas (default: generated_schemas.json)",
    )
    parser.add_argument(
        "--mode", default="balanced", choices=["fast", "balanced", "accurate"],
        help="Document parse quality for the convert step (default: balanced)",
    )
    parser.add_argument(
        "--poll-interval", type=float, default=DEFAULT_POLL_INTERVAL,
        help=f"Seconds between status checks (default: {DEFAULT_POLL_INTERVAL})",
    )
    parser.add_argument(
        "--timeout", type=float, default=DEFAULT_TIMEOUT,
        help=f"Seconds to wait for each async stage (default: {DEFAULT_TIMEOUT:.0f})",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    try:
        for env_path in load_env_files(args.env_file):
            print(f"Loaded env from {env_path}", flush=True)
        api_key = read_api_key()
        pdf_path = validate_pdf(args.pdf)

        session = requests.Session()
        session.headers.update({"X-API-Key": api_key})

        checkpoint_id = convert_and_get_checkpoint(
            session, pdf_path,
            mode=args.mode, interval=args.poll_interval, timeout=args.timeout,
        )
        result = generate_schemas(
            session, checkpoint_id,
            interval=args.poll_interval, timeout=args.timeout,
        )
        schemas = decode_suggestions(result["suggestions"])

    except DatalabError as exc:
        print(f"\nError: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\nInterrupted.", file=sys.stderr)
        return 130

    output = {
        "source_pdf": str(pdf_path),
        "checkpoint_id": checkpoint_id,
        "page_count": result.get("page_count"),
        "total_cost": result.get("total_cost"),
        "schemas": schemas,
    }

    print("\n=== Generated extraction schemas ===")
    print(json.dumps(schemas, indent=2, sort_keys=False))

    out_path = Path(args.output).expanduser()
    try:
        out_path.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
    except OSError as exc:
        print(f"\nError: could not write {out_path}: {exc}", file=sys.stderr)
        return 1

    print(f"\nSaved to {out_path}")
    print(
        "\nNote: these are SCHEMAS ONLY (field structure). To get populated values, "
        "pass one of them as `page_schema` to POST /api/v1/extract along with the "
        "same checkpoint_id."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
