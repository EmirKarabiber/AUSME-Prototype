// js/opportunity.js
// A3 – Opportunity Page JS (List + Search + Sort + Details w/ Descriptions)
//
// Data expectations:
// - data/opportunities.json: list objects (id/opp_id/number/title/post_date/due_date/etc.)
// - data/opportunity_detail.json: object keyed by "39237" etc, each record includes opp_id + description
/*
Data assumptions:
- opportunities.json provides list-level fields (id, title, number, due_date)
- opportunity_detail.json provides detail-level fields (description, funding)
- detail JSON is wrapped under { opportunities: { [opp_id]: {...} } }
- detail records are matched by opp_id (preferred) or number (fallback)
*/
const OPPORTUNITIES_LIST_URL = "data/opportunities.json";
const OPPORTUNITY_DETAIL_URL = "data/opportunity_detail.json";

// Update these when A2 finishes final HTML.
// Test harness should provide these IDs.
const SELECTORS = {
  listContainer: "#opportunity-list",
  detailsContainer: "#opportunity-details",
  searchInput: "#opportunity-search",
  sortSelect: "#opportunity-sort",
};

const state = {
  opportunities: [],
  selectedId: null,
  searchQuery: "",
  sortMode: "due_asc",

  detailsLoaded: false,
  detailsByOppId: new Map(),   // key: "39237" (opp_id)
  detailsByNumber: new Map(),  // key: "SGA-07-05" (number)
};

// ---------- utilities ----------
function $(sel) { return document.querySelector(sel); }

function formatDate(iso) {
  if (!iso) return "N/A";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}

function formatMoney(v) {
  if (v === null || v === undefined) return "N/A";
  const n = Number(v);
  if (Number.isNaN(n)) return "N/A";
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function parseDateMs(iso) {
  if (!iso) return Number.POSITIVE_INFINITY;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url} (${res.status})`);
  return res.json();
}

// Pull an ID from any common field name (list objects vary)
function getOppId(obj) {
  const id =
    obj?.opp_id ??
    obj?.opportunity_id ??
    obj?.id ??
    obj?.oppId ??
    null;
  return id === null || id === undefined ? null : String(id);
}

// ---------- list loading ----------
async function loadOpportunities() {
  const data = await fetchJson(OPPORTUNITIES_LIST_URL);

  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.opportunities)) return data.opportunities;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.rows)) return data.rows;
  if (Array.isArray(data?.results)) return data.results;

  return [];
}

async function loadDetailsIndexOnce() {
  if (state.detailsLoaded) return;

  const raw = await fetchJson(OPPORTUNITY_DETAIL_URL);

  // ✅ real records live under raw.opportunities
  const records = raw?.opportunities && typeof raw.opportunities === "object"
    ? raw.opportunities
    : raw;

  state.detailsByOppId = new Map();
  state.detailsByNumber = new Map();

  for (const [key, detail] of Object.entries(records || {})) {
    const idKey = String(detail?.opp_id ?? key).trim();
    state.detailsByOppId.set(idKey, detail);

    if (detail?.number) {
      state.detailsByNumber.set(String(detail.number).trim(), detail);
    }
  }

  state.detailsLoaded = true;

}

// ---------- search + sort ----------
function applySearch(opps, q) {
  const query = (q || "").trim().toLowerCase();
  if (!query) return opps;

  return opps.filter((o) => {
    const title = String(o.title ?? "").toLowerCase();
    const number = String(o.number ?? "").toLowerCase();
    return title.includes(query) || number.includes(query);
  });
}

function applySort(opps, mode) {
  const sorted = [...opps];

  switch (mode) {
    case "due_desc":
      sorted.sort((a, b) => parseDateMs(b.due_date) - parseDateMs(a.due_date));
      break;

    case "posted_desc":
      sorted.sort((a, b) => parseDateMs(b.post_date) - parseDateMs(a.post_date));
      break;

    case "posted_asc":
      sorted.sort((a, b) => parseDateMs(a.post_date) - parseDateMs(b.post_date));
      break;

    case "title_desc":
      sorted.sort((a, b) => String(b.title ?? "").localeCompare(String(a.title ?? "")));
      break;

    case "title_asc":
    default:
      sorted.sort((a, b) => String(a.title ?? "").localeCompare(String(b.title ?? "")));
      break;
  }

  return sorted;
}

function getVisibleOpportunities() {
  return applySort(applySearch(state.opportunities, state.searchQuery), state.sortMode);
}

// ---------- rendering ----------
function renderOpportunityList() {
  const container = $(SELECTORS.listContainer);
  if (!container) return;

  const visible = getVisibleOpportunities();
  container.innerHTML = "";

  if (visible.length === 0) {
    state.selectedId = null;
    renderOpportunityDetails(null);

    container.innerHTML = "<p>No matching opportunities.</p>";
    return;
  }

  const ul = document.createElement("ul");
  ul.className = "opportunity-list";

  for (const opp of visible) {
    // Determine the correct ID from list data
    const oppId = String(opp.id ?? opp.opp_id).trim();

    const li = document.createElement("li");
    li.className = "opportunity-item";
    li.dataset.id = oppId;

    // Make it obvious it's clickable
    li.style.cursor = "pointer";

    // Highlight selected item
    if (state.selectedId && oppId === String(state.selectedId)) {
      li.classList.add("selected");
    }

    li.innerHTML = `
      <strong>${opp.title ?? "Untitled Opportunity"}</strong><br />
      <small>
        ${opp.number ? `#${opp.number}` : "#N/A"}
        &nbsp;|&nbsp;
        Due: ${formatDate(opp.due_date)}
      </small>
    `;

    // DIRECT CLICK HANDLER (bulletproof)
    li.addEventListener("click", async (e) => {
      e.preventDefault();


        // 1) Update selected id
        state.selectedId = oppId;

        // 2) Update details FIRST
        await selectOpportunity(oppId);

        // 3) Then re-render list to update highlight
        renderOpportunityList();

    });

    ul.appendChild(li);
  }
  container.appendChild(ul);
}
function renderOpportunityDetails(detail) {
  const container = $(SELECTORS.detailsContainer);
  if (!container) return;

  // No selection or empty result → hide details
  if (!detail || !detail.opp_id) {
    container.innerHTML = "<p><em>No selection</em></p>";
    return;
  }
  container.innerHTML = `
    <h3>${detail.title ?? "Untitled Opportunity"}</h3>

    <p><strong>Opportunity Number:</strong> ${detail.number ?? "N/A"}</p>
    <p><strong>Posted:</strong> ${formatDate(detail.post_date)}</p>
    <p><strong>Due:</strong> ${formatDate(detail.due_date)}</p>

    <p><strong>Award Floor:</strong> ${formatMoney(detail.award_floor)}</p>
    <p><strong>Award Ceiling:</strong> ${formatMoney(detail.award_ceiling)}</p>
    <p><strong>Estimated Funding:</strong> ${formatMoney(detail.estimated_funding)}</p>

    <p><strong>Description:</strong></p>
    <p>${detail.description ?? "N/A"}</p>

    <p><strong>Agency ID:</strong> ${detail.agency_id ?? "N/A"}</p>
    <p><strong>Category ID:</strong> ${detail.category_id ?? "N/A"}</p>
  `;
}

// ---------- selection + details merge ----------
async function selectOpportunity(oppId) {
  state.selectedId = String(oppId);

  // Re-render list to highlight selection
  renderOpportunityList();

  // Merge list fields + details fields
  const listObj = state.opportunities.find((o) => getOppId(o) === String(oppId));

  await loadDetailsIndexOnce();

  const detailObj =
    state.detailsByOppId.get(String(oppId)) ??
    (listObj?.number ? state.detailsByNumber.get(String(listObj.number)) : undefined);


  const merged = { ...(listObj || {}), ...(detailObj || {}) };
  renderOpportunityDetails(merged);
}

// ---------- wiring controls ----------
function wireControls() {
  const searchEl = $(SELECTORS.searchInput);
  if (searchEl) {
    searchEl.addEventListener("input", (e) => {
      state.searchQuery = e.target.value;
      renderOpportunityList();

      // Optional: keep details aligned with first visible item
      const visible = getVisibleOpportunities();
      if (visible.length) {
        const firstId = getOppId(visible[0]);
        if (firstId) selectOpportunity(firstId).catch(console.error);
      } else {
        renderOpportunityDetails({ title: "No selection", description: "No matching opportunities." });
      }
    });
  }

  const sortEl = $(SELECTORS.sortSelect);
  if (sortEl) {
    sortEl.addEventListener("change", (e) => {
      state.sortMode = e.target.value;
      renderOpportunityList();

      const visible = getVisibleOpportunities();
      if (visible.length) {
        const firstId = getOppId(visible[0]);
        if (firstId) selectOpportunity(firstId).catch(console.error);
      }
    });
  }
}

// ---------- init ----------
async function initOpportunityPage() {
  try {
    state.opportunities = await loadOpportunities();

    // Render list and wire controls
    renderOpportunityList();
    wireControls();

    // Select first visible by default
    const visible = getVisibleOpportunities();
    if (visible.length) {
      const firstId = getOppId(visible[0]);
      if (firstId) await selectOpportunity(firstId);
    }
  } catch (err) {
    console.error(err);
  }
}

document.addEventListener("DOMContentLoaded", initOpportunityPage);