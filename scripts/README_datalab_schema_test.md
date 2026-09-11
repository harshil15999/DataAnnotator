# `datalab_schema_test.py` — Datalab Generate Extraction Schemas probe

A standalone script for testing Datalab's schema-generation API against a local PDF.
It shares no code with the surrounding application and modifies no application files.

## Install

```bash
pip install requests
```

That is the only dependency; everything else is stdlib.

## Set the API key

The key is read from a **`.env` file** (or a real environment variable). It is never
hardcoded and never written to the output file.

Create `scripts/.env`:

```
DATALAB_API_KEY=dl_your_key_here
```

Get a key from <https://www.datalab.to/app/keys>.

**Where it looks**, nearest first — the first file containing the key wins:

1. `.env` next to the script (`scripts/.env`)
2. `.env` in the directory you ran the command from
3. `.env` in the parent project root

Pass `--env-file /path/to/.env` to override the search entirely.

**Precedence:** a real environment variable always beats a `.env` entry, matching
python-dotenv's default behaviour. So this still works for a one-off override:

```bash
DATALAB_API_KEY=dl_other_key python datalab_schema_test.py ./form.pdf
```

No new dependency is needed — the `.env` parser is built in (stdlib only). It handles
`KEY=value`, `export KEY=value`, `#` comments, inline trailing comments, and single- or
double-quoted values; malformed lines are skipped rather than fatal, so sharing a `.env`
with the rest of the project is safe.

> **Make sure `.env` is git-ignored before you commit.**

## Run

```bash
python datalab_schema_test.py ./form.pdf
```

Options:

| Flag | Default | Purpose |
|---|---|---|
| `-o, --output` | `generated_schemas.json` | Where to write the result |
| `--mode` | `balanced` | Parse quality for the convert step: `fast`, `balanced`, `accurate` |
| `--poll-interval` | `3.0` | Seconds between status checks (docs suggest ~2s) |
| `--timeout` | `600` | Seconds to wait for *each* async stage |
| `--env-file` | auto-search | Explicit path to a `.env` file |

Expected output:

```
Loaded env from /home/.../scripts/.env
Uploading PDF...
PDF uploaded.
Convert request ID: ...
Processing PDF...
  ... status=processing (poll #1)
checkpoint_id: ...
Generating extraction schemas...
Request ID: ...
Waiting for schema generation...
Schema generation completed.

=== Generated extraction schemas ===
{ ... }

Saved to generated_schemas.json
```

## The API sequence

Base URL `https://www.datalab.to/api/v1`, auth header `X-API-Key` on every request.

1. **`POST /convert`** — multipart/form-data with `file`, plus `save_checkpoint=true`,
   `output_format=markdown`, `mode`. Returns `request_id` and `request_check_url`.
2. **`GET /convert/{request_id}`** — polled until `status == "complete"`; the completed
   body carries `checkpoint_id`.
3. **`POST /marker/extraction/gen_schemas`** — JSON body `{"checkpoint_id": "..."}`.
   Returns `request_id` and `request_check_url`.
4. **`GET /marker/extraction/gen_schemas/{request_id}`** — polled until
   `status == "complete"`; the body carries `suggestions` with `simple_schema`,
   `moderate_schema` and `complex_schema` (each a JSON-encoded string), or a signed
   `result_url` to download when the payload is offloaded.

There is **no separate upload endpoint, presigned-URL step, or confirmation step**.
The PDF goes straight to `/convert` as multipart form data. The documented limits are
200 MB and 7,000 pages per request.

## What `checkpoint_id` represents

A `checkpoint_id` is a handle to Datalab's **parsed representation of your document** —
the OCR/layout output produced by the convert step. It exists so downstream operations
(schema generation, extraction, segmentation) can reuse that parse instead of
re-processing the PDF, which cuts both latency and cost.

It is only produced when `save_checkpoint=true` is passed to `/convert`. Note that
Datalab deletes results — checkpoints included — roughly **one hour** after processing
completes, so a checkpoint is not a long-term identifier.

## What `gen_schemas` does

It inspects the parsed document behind the checkpoint and proposes JSON Schemas
describing *what fields this document appears to contain*, at three complexity tiers:

- `simple_schema` — the handful of most obvious top-level fields
- `moderate_schema` — a fuller field set
- `complex_schema` — the most detailed structure, including nested objects/arrays

It is a starting point for authoring a schema, not an oracle. Expect to edit field
names, descriptions and types before using one in production.

## Does `gen_schemas` return populated form data? **No — schema only.**

This was verified against the documented response model for
`GET /api/v1/marker/extraction/gen_schemas/{request_id}`, whose fields are:

`status`, `success`, `error`, `suggestions` (`simple_schema` / `moderate_schema` /
`complex_schema`), `result_url`, `expires_in`, `page_count`, `total_cost`.

There is no field on that model that carries extracted values. In particular
`extraction_schema_json` — the field that *does* hold populated data — belongs to the
**extract/convert** result models, not to the schema-generation result model. So
`gen_schemas` returns the structure (field names, types, descriptions) with no values
filled in, exactly as expected.

## Using the generated schema for actual extraction

The generated schema is the input to a second, separate call:

```python
requests.post(
    "https://www.datalab.to/api/v1/extract",
    files={"file": ("form.pdf", fh, "application/pdf")},
    data={
        "page_schema": json.dumps(schema),   # one of the generated schemas
        "checkpoint_id": checkpoint_id,      # reuse the same parse
        "extraction_mode": "balanced",
    },
    headers={"X-API-Key": api_key},
)
```

Poll that request's `request_check_url` until `status == "complete"`, then read
`extraction_schema_json` (a JSON string) for the populated object. In `balanced` /
`accurate` modes each field is accompanied by `<field>_citations` (block IDs tracing
the value back to its location in the document) and `<field>_score` (a 1–5 confidence
with reasoning), plus an overall `extraction_score_average`.

Schemas you intend to reuse can be saved once via `POST /api/v1/extraction_schemas`
and then referenced by `schema_id` on subsequent `/extract` calls instead of being
re-sent inline.

## Is there a UI for this operation? **No dedicated one.**

Datalab's dashboard at <https://www.datalab.to/app/schemas> is a schema **management**
UI — you can create, edit, version, list and archive saved schemas there by hand. The
documentation describes *generating* schemas from a document only through the API/SDK;
there is no "generate schemas from this PDF" button documented. This script therefore
uses the REST API directly, which is the intended path for this operation.

## Error handling

The script exits non-zero with a plain-language message for:

- missing/empty `DATALAB_API_KEY` (in both `.env` and the environment)
- `--env-file` pointing at a file that does not exist
- PDF path that does not exist, is a directory, or is empty
- a `.pdf` that lacks the `%PDF-` magic bytes (catches HTML error pages and truncated
  downloads), and files over the 200 MB limit
- upload/network failures, HTTP 401/403 (bad key), 422 (validation, with the field
  detail printed), 429 (rate limit)
- API-level failures reported as `success: false` or `status: "failed"` in a 200 body
- timeout at either polling stage

Polling sleeps between attempts (no busy-loop) and rides out transient 429/5xx
responses with a longer backoff rather than aborting the run.

## Output file

`generated_schemas.json` contains the three decoded schemas plus the run's
`checkpoint_id`, `page_count` and `total_cost`. The API key is not included.
