# AUSME Prototype — User Manual

This guide is for people using the **AUSME Prototype** web application and the **keyword extraction notebook**. It explains what each part does and how to run it locally.

---

## 1. What this application is

The prototype helps you explore:

- **Funding opportunities** — browse open grants and similar notices, filter by agency and funding size, read full descriptions, and open the original opportunity URL.
- **Research experts** — search faculty and researchers, filter by college, department, degree, and citation activity, then open a researcher’s **papers** view with filters and sorting.

The **AI notebook** (`keyword_extraction_two_agent.ipynb`) is a separate tool: it runs a batch pipeline that reads opportunity text and **produces ranked keywords** (and evaluation outputs). It is meant for data preparation and analysis, not for day-to-day browsing in the browser.

---

## 2. Running the web app

1. Install [Node.js](https://nodejs.org/) if you do not already have it.
2. In the project folder, install dependencies once:
   ```bash
   npm install
   ```
3. Start a local web server:
   ```bash
   npm start
   ```
4. Open a browser and go to: **http://localhost:3000/**

You should see the home screen with two buttons: **Opportunities** and **Experts**.

> **Note:** The app loads JSON data from the `data/` folder. If those files are missing or empty, lists may be empty.

---

## 3. Home page (`index.html`)

- **Opportunities** — opens the opportunity search experience.
- **Experts** — opens the expert search experience.

Use **Home** in the page header to return here from the other screens.

---

## 4. Opportunity Search (`opportunity.html`)

### What you can do

- **Search** — type in the search box to match **titles** or **opportunity numbers**. (Search does not scan the full description text in the list; open an opportunity to read the full description.)
- **Sort** — order by posted date, due date, or title (A–Z or Z–A).
- **Filters (sidebar)**  
  - **Funding** — narrow by approximate award size (buckets such as under $100K, $100K–$1M, etc.).  
  - **Agency** — use **All agencies** to clear the agency filter, or pick one agency in the tree. Selecting a parent agency includes **child agencies** in the results. Type in **Search agencies…** to narrow the tree. Expand or collapse branches with the toggle control where shown.  
- **List behavior** — by default, **closed** opportunities (past due date) are hidden. The list loads in pages of 24; use **Load more** (when shown) to reveal the next batch.
- **Detail view** — click an opportunity to see **full description** (cleaned for reading), **dates**, **funding**, **eligibility**, and a link to the **official URL** when available.

### Tips

- Choose **All agencies** at the top of the agency list to reset the agency filter.
- If an agency banner appears after you filter, it shows which agency context is active.

---

## 5. Expert Search (`experts.html`)

### What you can do

- **Search by name** — the search field supports **autocomplete** and a light “ghost” suggestion while you type.
- **Filters**  
  - **Colleges** — check a college; some colleges expand to show **departments**.  
  - **Degrees** — filter by degree where that data exists.  
  - **Min citations** — only show experts with at least this many citations (with respect to the time window below).  
  - **Time period** — slider labeled **All time** or **Since [year]** changes how citation counts are computed for display and filtering.
- **Sort** — by name (A–Z) or by citations.
- **View papers** — click a researcher card (or **View Papers**) to open their **papers** page.

### Clear filters

Use the **reset** control (circular arrow) in the filters panel to clear selections and reset citation and time settings.

---

## 6. Expert Papers (`papers.html`)

Opened from an expert card with a URL like `papers.html?auid=...`.

- **Header** — researcher name, title, college, total citations across listed papers.
- **Similar profiles** — quick links to related researchers (when data is available).
- **Paper filters** — year range, minimum citations, and a **time period** slider (same idea as on the expert list).
- **Search** — filter papers by **title or keyword** text.
- **Sort** — newest, oldest, or most cited.

Use **Back to Experts** to return to the expert list.

---

## 7. AI notebook — keyword extraction (`keyword_extraction_two_agent.ipynb`)

This Jupyter/Colab notebook implements a **two-stage (plus hybrid extraction) pipeline** for funding opportunities:

1. **Hybrid extraction** — combines an **LLM-based extractor** with **KeyBERT** so keywords come from both semantic keyphrase mining and generative extraction. Very short descriptions can trigger a **topic-only** edge-case path.
2. **Critic agent** — a second LLM pass **scores, refines, and filters** candidate keywords using a structured rubric.
3. **Similarity ranking** — keywords are further scored with **sentence embeddings** so the final list aligns with the opportunity text.

### Who should use it

- Data engineers or researchers who need **structured keywords per `opp_id`** for search, matching to experts, or reporting.

### Typical requirements

- Python environment with GPU support recommended for acceptable runtime (the notebook installs `transformers`, `torch`, `keybert`, etc.).
- **Google Colab**: optional cells mount **Google Drive** and may read a Hugging Face token from Colab **userdata** for model access.
- An **input JSON** file of opportunities (see the notebook’s `INPUT_JSON_PATH` / environment variables): records should include at least **`opp_id`**, **`title`**, and **`description`** where possible.

### Outputs (after a full run)

The pipeline writes timestamped files under the configured output directory (default in the notebook points at Drive), for example:

- **Full JSON** — complete records, metadata, critic details, and final keywords.
- **Simple JSON** — `opp_id` with keyword lists and scores.
- **CSV** — one row per keyword with rank and score for spreadsheets.
- **Debug log** — optional `model_responses_debug.jsonl` for raw model outputs when debugging.

### Suggested run order for new users

1. Run dependency and import cells in order from the top.
2. Adjust **configuration** (models, `PROCESS_START_INDEX`, `PROCESS_LIMIT`, paths) in the config cell.
3. Run **model loading** cells.
4. Use the **single-opportunity debug** cell to verify behavior on one record before a large batch.
5. Run the **main pipeline** cell, then optional **evaluation / charts** cells.

---

## 8. Limitations (prototype)

- Data is **static JSON** bundled with the project (or produced by your team’s export scripts). It is not a live federal grants database unless you refresh the files.
- Opportunity **list search** is limited to fields implemented in the UI (e.g. title/number), not full-text search across descriptions in the grid.
- The notebook is **not** wired into the static pages automatically; integrating extracted keywords into the web UI would be a separate development step.

---

## 9. Getting help

- For **git workflow** and team branches, see `BRANCH_GUIDE.md`.
- For **refreshing expert data from MySQL**, see `scripts/README.md`.
