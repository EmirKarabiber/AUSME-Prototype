# AUSME Prototype — Developer Manual

Technical reference for maintaining the static web app, data exports, and the keyword extraction notebook.

---

## 1. Repository overview

| Area | Role |
|------|------|
| `index.html` | Entry hub linking to Opportunities and Experts |
| `opportunity.html` + `js/opportunity.js` | Opportunity list, filters, detail view |
| `experts.html` + `js/experts/pages/home.js` | Expert grid, filters, autocomplete |
| `papers.html` + `js/experts/pages/profile.js` | Per-expert papers UI |
| `css/` | Shared and page-specific styles |
| `data/` | JSON consumed by the browser (`opportunities.json`, `opportunity_detail.json`, `agency.json`, `experts.json`, etc.) |
| `scripts/` | Node tooling (e.g. MySQL → JSON export for experts) |
| `keyword_extraction_two_agent.ipynb` | Offline LLM + KeyBERT + critic pipeline for opportunity keywords |

**Stack:** Plain HTML, CSS, and browser JavaScript. No build step for the UI. Local serving uses `npx http-server` via `npm start` (`package.json`).

---

## 2. Local development

```bash
npm install
npm start
# http://localhost:3000
```

`http-server` is invoked with `-c-1` to disable caching, which avoids stale JSON during iteration.

---

## 3. Web app architecture

### 3.1 Opportunities (`js/opportunity.js`)

- **Data sources**  
  - `data/opportunities.json` — list fields: `opp_id`, `title`, `post_date`, `due_date`, `agency_id`, funding, eligibility JSON string, etc.  
  - `data/opportunity_detail.json` — sparse merge keyed by `opp_id`: `description`, `url` (list + detail are merged in memory).  
  - Agency hierarchy: loaded from `data/agency.json` (objects with `id` / `agency_id`, `parent_id`, `name`) to support parent/child agency filters and counts. If that fetch fails, the sidebar falls back to a flat list derived from opportunity rows.

- **Filtering**  
  - **Open only:** `due_date` absent or not before today.  
  - **Funding buckets:** compares `award_ceiling` with fallback to `estimated_funding`.  
  - **Agency:** `selectedAgencyScopeIds` is a set of the selected node and **all descendants** (`getDescendantsInclusive`).

- **Search / sort**  
  - Search: lowercase substring on `title` and `number`.  
  - Sort: due date, post date, title (`getFilteredAndSorted`).

- **Rendering**  
  - List vs detail toggles `#opportunity-list-view` / `#opportunity-detail-view`.  
  - HTML in descriptions is stripped safely; `fixSpacing` improves plain-text readability.  
  - Agency logos: `AGENCY_LOGOS` map + optional walk up `parent_id` via `getAgencyLogoFor`.

- **Global hook** — `window.OpportunityFilter` exposes `applyAgencyNames` and `clearFilters()` for programmatic resets (e.g. console or future UI).

### 3.2 Experts module (`js/experts/`)

ES modules under `js/experts/`:

| File | Responsibility |
|------|----------------|
| `pages/home.js` | Bootstraps expert list: loads data, builds nested college/department checkboxes, wires events, `refreshHome()` |
| `pages/profile.js` | Papers page: reads `auid` query param, loads details + similar profiles, paper filters |
| `services/dataService.js` | Fetches `data/experts.json`, `data/expert_details.json`, `data/expert_similar_profiles.json` |
| `utils/logic.js` | `filterExperts`, `sortData`, citation calculations vs recency year |
| `ui/uiManager.js` | DOM helpers, `renderExperts`, `renderPapers`, checkbox rendering |
| `ui/autocomplete.js` | Name autocomplete + ghost text |
| `utils/debounce.js` | Debounced input for citation filter |

**Asset conventions**

- Headshots: `images/headshots/{auid}.jpg` with `default.jpg` fallback.  
- College icons: `images/college_icons/{collegeName}.svg` (hidden on error).

**HTML script tags**

- `experts.html` → `type="module" src="js/experts/pages/home.js"`  
- `papers.html` → `type="module" src="js/experts/pages/profile.js"`

### 3.3 Styling

- Global: `css/styles.css`  
- Opportunities: `css/opportunity.css`  
- Inline styles in `experts.html` support autocomplete layering.

---

## 4. Data pipeline: experts (MySQL → JSON)

Documented in `scripts/README.md`.

- **Script:** `scripts/experts_export.js`  
- **Commands:** `npm run export:experts:inspect` (schema), `npm run export:experts` (write files)  
- **Config:** `.env` with `MYSQL_HOST`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE` (use `.env.example` as template; do not commit secrets).

**Outputs**

- `data/experts.json` — summary list for the grid  
- `data/expert_details.json` — keyed detail including publications  
- `data/expert_similar_profiles.json` — similar researcher IDs per `auid`

If table names differ, use `--inspect` and adjust SQL in the script.

---

## 5. Notebook: `keyword_extraction_two_agent.ipynb`

### 5.1 Purpose

Batch-process funding opportunities to produce **ranked keywords** per `opp_id`, using:

- **Extractor LLM** (`EXTRACTOR_MODEL_ID`, default `microsoft/phi-2` unless overridden)  
- **KeyBERT** parallel candidates  
- **Critic LLM** (`CRITIC_MODEL_ID`) for structured scoring and keep/drop  
- **SentenceTransformer** (`all-MiniLM-L6-v2`) for similarity-based score combination (`combine_scores` / `score_keywords_by_similarity`)

Edge cases: short text uses `EDGE_CASE_WORD_THRESHOLD` and `TOPIC_PROMPT` / `topic_agent` path.

### 5.2 Configuration (config cell)

Notable environment-driven variables:

| Variable | Meaning |
|----------|---------|
| `HF_TOKEN` / `HUGGING_FACE_HUB_TOKEN` | Hugging Face auth if needed |
| `EXTRACTOR_MODEL_ID` / `CRITIC_MODEL_ID` | Model IDs |
| `MAX_NEW_TOKENS_*` | Generation caps for extractor, topic, critic |
| `EDGE_CASE_WORD_THRESHOLD` | Word-count threshold for short-description handling |
| `KEYBERT_TOP_N` | KeyBERT candidate count |
| `INPUT_JSON_PATH` | Input opportunities JSON |
| `PROCESS_START_INDEX` / `PROCESS_LIMIT` | Slice for partial runs |
| `MIN_CRITIC_SCORE_TO_KEEP` / `MIN_KEYWORDS_PER_OPP` | Critic retention and floor |
| `OUTPUT_DIR` | Where timestamped exports are written |

Colab may set `HF_TOKEN` from `google.colab.userdata`.

### 5.3 Cell flow (conceptual)

1. Dependencies (`%pip install ...`)  
2. Imports (`torch`, `transformers`, `pandas`, etc.)  
3. Config / model IDs  
4. Prompt templates: `EXTRACTOR_PROMPT`, `TOPIC_PROMPT`, `CRITIC_PROMPT`  
5. Parsing helpers (`parse_keyword_list_payload`, JSON retry wrapper)  
6. Score normalization utilities  
7. Model loading (extractor, critic, KeyBERT backend)  
8. Helpers: truncation, `extractor_agent_parallel`, `critic_agent`, `run_with_json_retries`  
9. Similarity scoring (`SentenceTransformer`)  
10. Optional `drive.mount`  
11. Main pipeline loop: writes `keyword_extraction_results_{timestamp}.json`, `keywords_simple_{timestamp}.json`, `keywords_table_{timestamp}.csv`  
12. Debug / single-`opp` cell for troubleshooting  
13. Evaluation / plotting cells (`evaluate_ranking_quality`, histograms) — some plotting cells may use placeholder data; verify before relying on them for production metrics.

### 5.4 Integration notes

- The static opportunity UI **does not** currently consume notebook output; merging `keywords_simple_*.json` (or similar) into `opportunities.json` / detail payloads would require a small ETL step and UI changes.  
- `model_responses_debug.jsonl` can grow quickly; truncate or disable logging in `log_model_raw_output` when not debugging.

---

## 6. Git workflow

See `BRANCH_GUIDE.md`:

- **`main`** — stable, PR-only  
- **`opportunity`** — opportunity page work  
- **`experts`** — experts page work  

Merge `main` into feature branches periodically to reduce conflicts.

---

## 7. Dependencies (`package.json`)

| Package | Use |
|---------|-----|
| `http-server` (via `npx`) | Static hosting for development |
| `mysql2` | Expert export script |
| `dotenv` | Load `.env` for export script |

---

## 8. Testing and quality

There is no centralized automated test suite in this prototype. Suggested manual checks:

- Opportunities: agency tree selection, funding buckets, merge of list + detail JSON, XSS-safe rendering of descriptions.  
- Experts: filter combinations, autocomplete, papers filters, broken image fallbacks.  
- Export script: run `--inspect` against target DB before changing SQL.

---

## 9. Related docs

- `UserManual.md` — end-user-facing guide  
- `BRANCH_GUIDE.md` — branch policy  
- `scripts/README.md` — expert export setup  
