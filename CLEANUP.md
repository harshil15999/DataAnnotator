# Cleanup review — what should be removed, and why

Audit of the codebase after the JSON+PDF migration. Tick a box to have it actioned;
delete a row to reject it.

Everything below was verified against the code as it stands — each item was checked for
references before being listed.

---

## 1. Files and directories

| ☐ | Item | Size | Why |
| --- | --- | --- | --- |
| ☐ | `.output/` | 5.0 M | Production build from before the rewrite. Still contains `hydrateFromHtml` and `validationDir`, so `node .output/server/index.mjs` — the production start command — runs the **old** app against the **new** folder layout. It would look for `files/validation/`, try to parse `.html`, and ignore JSON pairs entirely. |
| ☐ | `--host/` | 912 K | A directory literally named `--host`, created by a mistyped `nuxt dev --host`. Not a real path, referenced by nothing. |


## 2. Dead code — `app/components/OcrConsole.vue`

| ☐ | Symbol | Lines | Why |
| --- | --- | --- | --- |
| ☐ | `hintShow` | 51, 237, 279 | Declared and assigned twice, **never rendered anywhere**. Pure dead state. |
| ☐ | `mode`, `setMode` | 40, 130, 741–744, 809 | The Long/Base toggle. Feeds only its own `MODE` readout; no request or behaviour depends on it. |
| ☐ | `ngramOn`, `toggleNgram` | 41, 134, 751 | The NGRAM switch. Flips a boolean nothing consumes. |
| ☐ | PROMPT input | 933 | Hardcoded `value="document parsing."`, never read on submit. |
| ☐ | `MODEL baidu/Unlimited-OCR` | 808 | Names a model this server never calls. Not merely dead — actively false. |


> The last row is the only one with a behaviour change: the CSV button would start
> emitting the same columns as EXPORT ALL. That is the point of fixing it.

## 3. Server — dead code

| ☐ | Item | Where | Why |
| --- | --- | --- | --- |
| ☐ | `mime_type` column | `db.ts` schema, `insertForm`, `insertFailed`, `FormRow`, `RawRow`, `hydrate` | Written on every insert, read by no endpoint, no console code, no export column. Exactly the dead weight `byte_size` was. |

## 4. Server — stale comments

No behaviour change; all describe machinery that has been deleted.

| ☐ | Comment | Where |
| --- | --- | --- |
| ☐ | references `POST /api/ocr` | `api/form.get.ts:11` — endpoint deleted |
| ☐ | "the model" ×6 | `utils/db.ts` 41, 44, 52, 118, 229, 246, 273 — no model in this server |
| ☐ | "the HTML conversions the watcher hydrates" | `utils/formResult.ts:9-10` — the watcher reads JSON |
| ☐ | "a page the model reads poorly" | `utils/formTemplate.ts:9` |
| ☐ | "Whether the model managed to read this one" | `api/validation/next.get.ts:12` — describes `ocrFailed` |
| ☐ | "the model's values", "the cells the model fills" | `OcrConsole.vue:58`, `:1770` |

## 5. Config

| ☐ | Item | Where | Why |
| --- | --- | --- | --- |
| ☐ | `QUEUE_VALIDATION_DIR` | `.env.example` | The key no longer exists in `nuxt.config.ts`. Setting it does nothing. |
| ☐ | "Forms a converter has already turned into HTML" | `.env.example` | Describes the deleted ingestion path. |

## 6. Data

| ☐ | Item | Why |
| --- | --- | --- |
| ☐ | Row **#3** `Form_Test.html` | Status `approved`, but the file exists nowhere on disk. Still appears in EXPORT ALL as 91/210. |
| ☐ | Row **#2** error text | Cites `HF_TOKEN` / `HF_ENDPOINT_URL` — a feature that no longer exists. |

---

## 7. Rename, not remove — listed separately on purpose

These are not dead; they *work*. They just name a world that no longer exists. This is the
largest and riskiest change in the document, which is why it is not mixed in above.

| ☐ | Name | Should mean | Cost of changing |
| --- | --- | --- | --- |
| ☐ | `ocr_filled`, `ocr_raw`, `ocr_ms`, `ocr_total` | No OCR happens in this server; these are "how the extraction went" | DB column rename ⇒ the database must be recreated (no migrations by design) |
| ☐ | `OcrResponse`, `OcrPageAnswer`, `OcrPageInfo`, `ocrFailed` | Same — they are the extraction's vocabulary now | Type renames across `formResult.ts`, `db.ts`, endpoints, console |
| ☐ | status `under_validation` | "waiting to be checked" — there is no validation folder any more | `CHECK` constraint ⇒ database recreated |
| ☐ | `/api/validation/*` route tree | The folder it was named for is gone | Every endpoint path + the console's fetch URLs |
| ☐ | `processedDir` | Points at a folder called `processing` | One config key, four references |

**Recommendation:** do 1–6 now; treat 7 as a separate decision. Nothing in 7 is broken —
it is only confusing to read — and the first three rows force deleting `.data/forms.db`,
which throws away the approved rows unless they are exported first.

---

## Not removed — checked and kept

| Item | Why it stays |
| --- | --- |
| `files/incoming/` + `incomingDir` | `scripts/extract.py` watches this folder. Looked dead from inside `server/`; is not. |
| `FormRow`, `NewForm`, `CsvLayout`, `JsonHydration`, `RasterizeOptions` | Flagged as unused exports by a naive scan, but each names the signature of an exported function. Un-exporting makes the public API unnameable for no gain. |
| `PDF_RENDER_DPI`, `MAX_PAGES`, `loadFormTemplate` | Used inside their own file — already un-exported rather than deleted. |
