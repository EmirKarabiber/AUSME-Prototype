// js/opportunity.js
(() => {
  const LIST_URL    = "data/Opportunities.json";          // full list — opp_id, title, dates, funding, eligibility, etc.
  const DETAILS_URL = "data/Opportunities_details.json";    // details only — opp_id, description, url

  let listOpps      = [];
  let detailsById   = new Map();
  let selectedOppId = null;
  let fundingMin    = null;
  let fundingMax    = null;
  let selectedAgencyId = null;
  let visibleCount  = 24;
  const PAGE_SIZE   = 24;

  const $ = (id) => document.getElementById(id);

  const els = {
    search:     $("opportunity-search"),
    sort:       $("opportunity-sort"),
    list:       $("opportunity-list"),
    details:    $("opportunity-details"),
    totalCount: $("opportunity-total-count"),
    sidebar:    $("opportunity-sidebar"),
  };

  /* ─────────────────────────────────────────────
     HELPERS
  ───────────────────────────────────────────── */
  function normalizeNull(v) {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    return (!s || s.toUpperCase() === "NULL") ? null : v;
  }

  function safeJsonParse(s) { try { return JSON.parse(s); } catch { return null; } }

  function parseDateMaybe(str) {
    str = normalizeNull(str);
    if (!str) return null;
    const s   = String(str).replace(" ", "T");
    const iso = /[Zz]|[+-]\d{2}:\d{2}$/.test(s) ? s : s + "Z";
    const d   = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function fmtDate(d) {
    return d ? d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "N/A";
  }

  function moneyMaybe(n) {
    n = normalizeNull(n);
    if (n === null || Number.isNaN(Number(n))) return "N/A";
    return Number(n).toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&",  "&amp;")
      .replaceAll("<",  "&lt;")
      .replaceAll(">",  "&gt;")
      .replaceAll('"',  "&quot;")
      .replaceAll("'",  "&#039;");
  }

  // Strips HTML tags, inserts spaces at block boundaries so words don't jam together
  function stripHtmlToText(html) {
    if (!html) return "";
    const spaced = String(html)
      .replace(/<\/(p|div|li|h[1-6]|section|article|tr|td|th)>/gi, " ")
      .replace(/<br\s*\/?>/gi, " ");
    const div = document.createElement("div");
    div.innerHTML = spaced;
    return (div.textContent || div.innerText || "").replace(/\s+/g, " ").trim();
  }

  // Fixes plain text where sentences are jammed together with no space (e.g. "...year.Next...")
  function fixSpacing(text) {
    if (!text) return "";
    return text.replace(/([.!?])([A-Z])/g, "$1 $2");
  }

  /* ─────────────────────────────────────────────
     MERGE: list record + detail record
     Detail JSON only has opp_id, description, url —
     so spreading it is safe with no risk of clobbering
     eligibility or any other list fields.
  ───────────────────────────────────────────── */
  function mergedOpp(base) {
    const detail = detailsById.get(String(base?.opp_id ?? "")) || {};
    return { ...base, ...detail };
  }

  /* ─────────────────────────────────────────────
     FILTER PREDICATES
  ───────────────────────────────────────────── */
  function isOpenOpportunity(o) {
    const due = parseDateMaybe(o.due_date);
    return !due || due.getTime() >= Date.now();
  }

  function matchesFunding(o) {
    if (fundingMin === null && fundingMax === null) return true;
    const v = Number(o.award_ceiling ?? o.estimated_funding ?? NaN);
    if (!Number.isFinite(v)) return false;
    if (fundingMin !== null && v < fundingMin) return false;
    if (fundingMax !== null && v > fundingMax) return false;
    return true;
  }

  function matchesAgency(o) {
    if (!selectedAgencyId) return true;
    return String(o.agency_id) === String(selectedAgencyId);
  }

  /* ─────────────────────────────────────────────
     FILTER + SORT PIPELINE
  ───────────────────────────────────────────── */
  function getFilteredAndSorted() {
    const q        = (els.search?.value || "").trim().toLowerCase();
    const sortMode = els.sort?.value || "due_asc";

    let arr = listOpps.slice()
      .filter(isOpenOpportunity)
      .filter(matchesFunding)
      .filter(matchesAgency);

    if (q) {
      arr = arr.filter(o =>
        (o.title  || "").toLowerCase().includes(q) ||
        String(o.number ?? "").toLowerCase().includes(q)
      );
    }

    const dueTime  = o => parseDateMaybe(o.due_date)?.getTime()  ?? Infinity;
    const postTime = o => parseDateMaybe(o.post_date)?.getTime() ?? -Infinity;

    switch (sortMode) {
      case "due_asc":     arr.sort((a, b) => dueTime(a)  - dueTime(b));  break;
      case "due_desc":    arr.sort((a, b) => dueTime(b)  - dueTime(a));  break;
      case "posted_desc": arr.sort((a, b) => postTime(b) - postTime(a)); break;
      case "posted_asc":  arr.sort((a, b) => postTime(a) - postTime(b)); break;
      case "title_desc":  arr.sort((a, b) => (b.title || "").localeCompare(a.title || "")); break;
      case "title_asc":
      default:            arr.sort((a, b) => (a.title || "").localeCompare(b.title || "")); break;
    }
    return arr;
  }

  /* ─────────────────────────────────────────────
     SIDEBAR
  ───────────────────────────────────────────── */
  const FUNDING_BUCKETS = [
    { label: "Any amount",  min: null,     max: null    },
    { label: "Under $100K", min: null,     max: 99999   },
    { label: "$100K – $1M", min: 100000,   max: 999999  },
    { label: "$1M – $10M",  min: 1000000,  max: 9999999 },
    { label: "Over $10M",   min: 10000000, max: null    },
  ];

  function buildSidebar() {
    if (!els.sidebar) return;

    const openOpps = listOpps.filter(isOpenOpportunity);

    // Count opps per agency, sorted by count descending
    const agencyCounts = new Map();
    openOpps.forEach(o => {
      const id = String(o.agency_id);
      agencyCounts.set(id, (agencyCounts.get(id) || 0) + 1);
    });
    const agencyEntries = [...agencyCounts.entries()].sort((a, b) => b[1] - a[1]);

    els.sidebar.innerHTML = `
      <!-- FUNDING FILTER -->
      <div class="filter-section">
        <h3 class="filter-heading">Award Amount</h3>
        <ul class="filter-list" id="funding-filter-list">
          ${FUNDING_BUCKETS.map((b, i) => {
            const count = i === 0
              ? openOpps.length
              : openOpps.filter(o => {
                  const v = Number(o.award_ceiling ?? o.estimated_funding ?? NaN);
                  if (!Number.isFinite(v)) return false;
                  if (b.min !== null && v < b.min) return false;
                  if (b.max !== null && v > b.max) return false;
                  return true;
                }).length;
            return `
              <li>
                <label class="filter-option${i === 0 ? " active" : ""}">
                  <input type="radio" name="funding-range" value="${i}" ${i === 0 ? "checked" : ""}>
                  <span class="filter-label">${escapeHtml(b.label)}</span>
                  <span class="filter-count">${count.toLocaleString()}</span>
                </label>
              </li>`;
          }).join("")}
        </ul>
      </div>

      <!-- AGENCY FILTER -->
      <div class="filter-section">
        <h3 class="filter-heading">Agency</h3>
        <div class="agency-search-wrap">
          <input id="agency-search" type="text" class="agency-search-input"
                 placeholder="Search agencies…" autocomplete="off">
        </div>
        <ul class="filter-list agency-filter-list" id="agency-filter-list">
          <li>
            <label class="filter-option active">
              <input type="radio" name="agency-select" value="" checked>
              <span class="filter-label">All agencies</span>
              <span class="filter-count">${openOpps.length.toLocaleString()}</span>
            </label>
          </li>
          ${agencyEntries.map(([id, count]) => `
            <li data-agency-entry="${escapeHtml(id)}">
              <label class="filter-option">
                <input type="radio" name="agency-select" value="${escapeHtml(id)}">
                <span class="filter-label agency-name" data-agency-id="${escapeHtml(id)}">
                  Agency ${escapeHtml(id)}
                </span>
                <span class="filter-count">${count.toLocaleString()}</span>
              </label>
            </li>`).join("")}
        </ul>
      </div>
    `;

    // Funding listeners
    els.sidebar.querySelectorAll('input[name="funding-range"]').forEach(radio => {
      radio.addEventListener("change", () => {
        const b       = FUNDING_BUCKETS[Number(radio.value)];
        fundingMin    = b.min;
        fundingMax    = b.max;
        selectedOppId = null;
        visibleCount  = PAGE_SIZE;
        els.sidebar.querySelectorAll("#funding-filter-list .filter-option").forEach(l => l.classList.remove("active"));
        radio.closest(".filter-option").classList.add("active");
        renderList();
        renderDetails();
      });
    });

    // Agency listeners
    els.sidebar.querySelectorAll('input[name="agency-select"]').forEach(radio => {
      radio.addEventListener("change", () => {
        selectedAgencyId = radio.value || null;
        selectedOppId    = null;
        visibleCount     = PAGE_SIZE;
        els.sidebar.querySelectorAll("#agency-filter-list .filter-option").forEach(l => l.classList.remove("active"));
        radio.closest(".filter-option").classList.add("active");
        renderList();
        renderDetails();
      });
    });

    // Agency search box
    $("agency-search")?.addEventListener("input", (e) => {
      const q = e.target.value.trim().toLowerCase();
      els.sidebar.querySelectorAll("#agency-filter-list li[data-agency-entry]").forEach(li => {
        const label = li.querySelector(".agency-name")?.textContent?.toLowerCase() || "";
        li.style.display = (!q || label.includes(q)) ? "" : "none";
      });
    });
  }

  /* ─────────────────────────────────────────────
     PUBLIC API
     Once Krish delivers agency names, call:
       window.OpportunityFilter.applyAgencyNames({ "1": "NIH", "7": "NSF", ... })
  ───────────────────────────────────────────── */
  window.OpportunityFilter = {
    applyAgencyNames(nameMap) {
      document.querySelectorAll(".agency-name[data-agency-id]").forEach(el => {
        const name = nameMap[el.getAttribute("data-agency-id")];
        if (name) el.textContent = name;
      });
    },
    clearFilters() {
      fundingMin = null; fundingMax = null;
      selectedAgencyId = null; selectedOppId = null;
      visibleCount = PAGE_SIZE;
      if (els.search) els.search.value = "";
      document.querySelector('input[name="funding-range"]')?.dispatchEvent(new Event("change"));
      document.querySelector('input[name="agency-select"]')?.dispatchEvent(new Event("change"));
    },
  };

  /* ─────────────────────────────────────────────
     RENDER: CARD LIST
  ───────────────────────────────────────────── */
  function renderList() {
    if (!els.list) return;
    const arr = getFilteredAndSorted();

    if (els.totalCount) {
      els.totalCount.textContent =
        arr.length === 1 ? "1 open opportunity" : `${arr.length.toLocaleString()} open opportunities`;
    }

    els.list.classList.add("grid");

    if (arr.length === 0) {
      els.list.innerHTML = `<p class="no-results">No opportunities match your filters.</p>`;
      return;
    }

    els.list.innerHTML = arr.slice(0, visibleCount).map(o => {
      const id       = String(o.opp_id ?? "");
      const selected = id === String(selectedOppId);
      // opp_id / agency_id / category_id intentionally NOT rendered in UI
      return `
        <button class="opportunity-card${selected ? " selected" : ""}"
                data-opp-id="${escapeHtml(id)}" type="button">
          <div class="opp-title">${escapeHtml(o.title || "(Untitled)")}</div>
          <div class="opp-meta">
            <span><strong>Posted:</strong> ${fmtDate(parseDateMaybe(o.post_date))}</span>
            <span><strong>Due:</strong> ${fmtDate(parseDateMaybe(o.due_date))}</span>
          </div>
        </button>`;
    }).join("");

    els.list.querySelectorAll(".opportunity-card").forEach(card => {
      card.addEventListener("click", () => {
        selectedOppId = card.getAttribute("data-opp-id");
        renderList();
        renderDetails();
      });
    });

    if (arr.length > visibleCount) {
      const remaining = Math.min(PAGE_SIZE, arr.length - visibleCount);
      els.list.insertAdjacentHTML("beforeend", `
        <div class="load-more-wrap">
          <button class="load-more-btn" type="button">Load more (${remaining} more)</button>
        </div>`);
      els.list.querySelector(".load-more-btn")?.addEventListener("click", () => {
        visibleCount += PAGE_SIZE;
        renderList();
      });
    }
  }

  /* ─────────────────────────────────────────────
     RENDER: DETAIL PANEL
  ───────────────────────────────────────────── */
  function renderDetails() {
    if (!els.details) return;
    if (!selectedOppId) { els.details.innerHTML = ""; return; }

    const base = listOpps.find(o => String(o.opp_id) === String(selectedOppId));
    if (!base) { els.details.innerHTML = ""; return; }

    const opp  = mergedOpp(base);
    const url  = normalizeNull(opp.url);
    // description comes from detail JSON — strip any HTML and fix spacing
    const desc = fixSpacing(stripHtmlToText(normalizeNull(opp.description) || ""));

    // eligibility comes from list JSON — parse the stored JSON string
    const eligibilityRaw = normalizeNull(opp.eligibility);
    const eligParsed =
      Array.isArray(eligibilityRaw)      ? eligibilityRaw :
      typeof eligibilityRaw === "string" ? safeJsonParse(eligibilityRaw) : null;
    const eligNames = Array.isArray(eligParsed)
      ? eligParsed.map(e => e?.applicant_type_name).filter(Boolean) : [];

    // opp_id / agency_id / category_id intentionally NOT rendered in UI
    els.details.innerHTML = `
      <div class="opp-details-card">
        <h2>${escapeHtml(opp.title || "(Untitled)")}</h2>
        <p><strong>Posted:</strong> ${fmtDate(parseDateMaybe(opp.post_date))}</p>
        <p><strong>Due:</strong> ${fmtDate(parseDateMaybe(opp.due_date))}</p>
        <hr />
        <p><strong>Award ceiling:</strong> ${moneyMaybe(opp.award_ceiling)}</p>
        <p><strong>Award floor:</strong> ${moneyMaybe(opp.award_floor)}</p>
        <p><strong>Estimated funding:</strong> ${moneyMaybe(opp.estimated_funding)}</p>
        ${url ? `<p><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">View opportunity ↗</a></p>` : ""}
        <hr />
        <p><strong>Description:</strong></p>
        ${desc ? `<p>${escapeHtml(desc)}</p>` : `<p>N/A</p>`}
        <p><strong>Eligibility:</strong></p>
        ${eligNames.length
          ? `<ul>${eligNames.map(x => `<li>${escapeHtml(x)}</li>`).join("")}</ul>`
          : `<p>N/A</p>`}
      </div>
    `;
  }

  /* ─────────────────────────────────────────────
     EVENT LISTENERS
  ───────────────────────────────────────────── */
  els.search?.addEventListener("input", () => {
    selectedOppId = null;
    visibleCount  = PAGE_SIZE;
    renderList();
    renderDetails();
  });

  els.sort?.addEventListener("change", () => {
    visibleCount = PAGE_SIZE;
    renderList();
  });

  /* ─────────────────────────────────────────────
     INIT
  ───────────────────────────────────────────── */
  async function init() {
    try {
      // Load list JSON
      const listRes = await fetch(LIST_URL, { cache: "no-store" });
      if (!listRes.ok) throw new Error(`Failed to fetch list: ${LIST_URL} (${listRes.status})`);
      const list = await listRes.json();
      if (!Array.isArray(list)) throw new Error(`List file must be a JSON array: ${LIST_URL}`);
      listOpps = list;

      // Load detail JSON (only opp_id, description, url — no overlapping fields)
      const detRes = await fetch(DETAILS_URL, { cache: "no-store" });
      if (!detRes.ok) throw new Error(`Failed to fetch details: ${DETAILS_URL} (${detRes.status})`);
      const details = await detRes.json();
      if (!Array.isArray(details)) throw new Error(`Details file must be a JSON array: ${DETAILS_URL}`);
      detailsById = new Map(details.map(d => [String(d.opp_id), d]));

      selectedOppId = null;
      buildSidebar();
      renderList();
      renderDetails();
    } catch (e) {
      console.error("[opportunity.js]", e);
      if (els.list) els.list.innerHTML = `<p class="error-msg">Failed to load opportunities. Please try again.</p>`;
      if (els.details) els.details.innerHTML = "";
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();