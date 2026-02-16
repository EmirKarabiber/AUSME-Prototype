// js/opportunity.js
// Role A3 – Opportunity Page JavaScript Logic
// Safe even before final HTML exists.

const OPPORTUNITIES_LIST_URL = "data/opportunities.json";
const OPPORTUNITY_DETAIL_URL = "data/opportunity_detail.json";

// TODO: Replace these IDs once A2 finishes opportunity.html
const SELECTORS = {
  listContainer: "#opportunity-list",
  detailsContainer: "#opportunity-details",

  // New (optional) controls
  searchInput: "#opportunity-search",
  sortSelect: "#opportunity-sort",
};

const state = {
  opportunities: [],
  selectedId: null,

  // New state for filtering/sorting
  searchQuery: "",
  sortMode: "due_asc",
};

function $(selector) {
  return document.querySelector(selector);
}

function formatDate(iso) {
  if (!iso) return "N/A";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}

function formatMoney(value) {
  if (value === null || value === undefined) return "N/A";
  return `$${Number(value).toLocaleString()}`;
}

function parseDateMs(iso) {
  if (!iso) return Number.POSITIVE_INFINITY; // put missing dates at end
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url} (${res.status})`);
  return res.json();
}

// opportunities.json → { opportunities: [...] }
async function loadOpportunities() {
  const data = await fetchJson(OPPORTUNITIES_LIST_URL);
  return Array.isArray(data.opportunities) ? data.opportunities : [];
}

// opportunity_detail.json → single object (for now)
async function loadOpportunityDetail() {
  return fetchJson(OPPORTUNITY_DETAIL_URL);
}

// -----------------------
// Filtering + Sorting
// -----------------------

function applySearch(opps, query) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return opps;

  return opps.filter((opp) => {
    const title = String(opp.title ?? "").toLowerCase();
    const number = String(opp.number ?? "").toLowerCase();
    return title.includes(q) || number.includes(q);
  });
}

function applySort(opps, mode) {
  const sorted = [...opps];

  switch (mode) {
    case "due_desc":
      sorted.sort((a, b) => parseDateMs(b.due_date) - parseDateMs(a.due_date));
      break;

    case "title_asc":
      sorted.sort((a, b) => String(a.title ?? "").localeCompare(String(b.title ?? "")));
      break;

    case "title_desc":
      sorted.sort((a, b) => String(b.title ?? "").localeCompare(String(a.title ?? "")));
      break;

    case "posted_desc":
        sorted.sort((a, b) => parseDateMs(b.post_date) - parseDateMs(a.post_date));
        break;

    case "posted_asc":
        sorted.sort((a, b) => parseDateMs(a.post_date) - parseDateMs(b.post_date));
        break;

    case "due_asc":
    default:
      sorted.sort((a, b) => parseDateMs(a.due_date) - parseDateMs(b.due_date));
      break;
  }

  return sorted;
}

function getVisibleOpportunities() {
  const filtered = applySearch(state.opportunities, state.searchQuery);
  return applySort(filtered, state.sortMode);
}

// -----------------------
// Rendering
// -----------------------

function renderOpportunityList() {
  const container = $(SELECTORS.listContainer);
  if (!container) return; // HTML not ready yet

  const visible = getVisibleOpportunities();
  container.innerHTML = "";

  if (!visible.length) {
    container.textContent = "No matching opportunities.";
    return;
  }

  const ul = document.createElement("ul");
  ul.className = "opportunity-list";

  visible.forEach((opp) => {
    const li = document.createElement("li");
    li.className = "opportunity-item";
    li.dataset.id = opp.id;

    if (String(opp.id) === String(state.selectedId)) li.classList.add("selected");

    li.innerHTML = `
      <strong>${opp.title ?? "Untitled Opportunity"}</strong><br />
      <small>${opp.number ? `#${opp.number} — ` : ""}Due: ${formatDate(opp.due_date)}</small>
    `;

    ul.appendChild(li);
  });

  container.appendChild(ul);
}

function renderOpportunityDetails(detail) {
  const container = $(SELECTORS.detailsContainer);
  if (!container) return; // HTML not ready yet

  container.innerHTML = `
    <h2>${detail.title ?? "Untitled Opportunity"}</h2>

    <p><strong>Opportunity Number:</strong> ${detail.number ?? "N/A"}</p>
    <p><strong>Posted:</strong> ${formatDate(detail.post_date)}</p>
    <p><strong>Due:</strong> ${formatDate(detail.due_date)}</p>

    <p><strong>Award Floor:</strong> ${formatMoney(detail.award_floor)}</p>
    <p><strong>Award Ceiling:</strong> ${formatMoney(detail.award_ceiling)}</p>
    <p><strong>Estimated Funding:</strong> ${formatMoney(detail.estimated_funding)}</p>

    <p><strong>Description:</strong></p>
    <p>${detail.description ?? "N/A"}</p>

    <p><strong>Agency ID:</strong> ${detail.agency?.id ?? "N/A"}</p>
    <p><strong>Category ID:</strong> ${detail.category?.id ?? "N/A"}</p>
  `;
}

// -----------------------
// Events
// -----------------------

async function onOpportunityClick(event) {
  const item = event.target.closest(".opportunity-item");
  if (!item) return;

  state.selectedId = item.dataset.id;
  renderOpportunityList();

  // NOTE: detail JSON is currently a single object, so this always loads the same details.
  // When your teammate adds per-id details, update this function to load by selectedId.
  try {
    const detail = await loadOpportunityDetail();
    renderOpportunityDetails(detail);
  } catch (err) {
    console.error(err);
  }
}

function wireSearchAndSortControls() {
  const searchEl = $(SELECTORS.searchInput);
  if (searchEl) {
    searchEl.addEventListener("input", (e) => {
      state.searchQuery = e.target.value;
      renderOpportunityList();
    });
  }

  const sortEl = $(SELECTORS.sortSelect);
  if (sortEl) {
    sortEl.addEventListener("change", (e) => {
      state.sortMode = e.target.value;
      renderOpportunityList();
    });
  }
}

// -----------------------
// Init
// -----------------------

async function initOpportunitiesPage() {
  try {
    state.opportunities = await loadOpportunities();

    // Default selection (first in sorted/filtered view)
    const visible = getVisibleOpportunities();
    if (visible.length) state.selectedId = visible[0].id;

    renderOpportunityList();

    const listContainer = $(SELECTORS.listContainer);
    if (listContainer) listContainer.addEventListener("click", onOpportunityClick);

    wireSearchAndSortControls();

    // Load details once (for now)
    if (state.opportunities.length) {
      const detail = await loadOpportunityDetail();
      renderOpportunityDetails(detail);
    }
  } catch (err) {
    console.error(err);
  }
}

document.addEventListener("DOMContentLoaded", initOpportunitiesPage);