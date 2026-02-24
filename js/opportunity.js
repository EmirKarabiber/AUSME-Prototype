// js/opportunity.js
(() => {
  const LIST_URL    = "data/Opportunities.json";        // opp_id, title, dates, funding, eligibility, etc.
  const DETAILS_URL = "data/Opportunity_detail.json";  // opp_id, description, url ONLY

  let listOpps      = [];
  let detailsById   = new Map();
  let selectedOppId = null;
  let fundingMin    = null;
  let fundingMax    = null;
  let selectedAgencyId = null;
  let agencyNamesById = new Map(); // populated after agencies.json loads
  let agencyById = new Map();      // id -> full agency object (name, parent_id, etc.)
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
    listView:   $("opportunity-list-view"),
    detailView: $("opportunity-detail-view"),
  };

  function showListView() {
    if (els.listView)   els.listView.style.display   = "";
    if (els.detailView) els.detailView.style.display = "none";
    selectedOppId = null;
    visibleCount  = PAGE_SIZE;
    renderAgencyBanner();
    renderList();
  }

  function showDetailView() {
    if (els.listView)   els.listView.style.display   = "none";
    if (els.detailView) els.detailView.style.display = "";
    renderDetails();
  }

  /* ─────────────────────────────────────────────
     HELPERS
  ───────────────────────────────────────────── */
    // --- Agency hierarchy (parent/child aware filtering) ---
  let agenciesRaw = [];                 // agencies_with_parent.json
  let agencyParentById = new Map();     // childId -> parentId (or null)
  let agencyChildrenById = new Map();   // parentId -> [childId, childId...]
  let agencyDescCache = new Map();      // id -> [id, ...descendants]
  let selectedAgencyScopeIds = null;    // Set of allowed agency_ids when filter is active

  function buildAgencyHierarchy(agencies) {
    agenciesRaw = Array.isArray(agencies) ? agencies : [];

    agencyParentById = new Map();
    agencyChildrenById = new Map();
    agencyDescCache = new Map();

    // init maps
    for (const a of agenciesRaw) {
      const id = String(a.id);
      const parent = (a.parent_id === null || a.parent_id === undefined) ? null : String(a.parent_id);
      agencyParentById.set(id, parent);
      if (!agencyChildrenById.has(id)) agencyChildrenById.set(id, []);
    }

    // build children lists
    for (const a of agenciesRaw) {
      const id = String(a.id);
      const parent = agencyParentById.get(id);
      if (parent) {
        if (!agencyChildrenById.has(parent)) agencyChildrenById.set(parent, []);
        agencyChildrenById.get(parent).push(id);
      }
    }
  }

  function getDescendantsInclusive(rootId) {
    const rid = String(rootId);
    if (agencyDescCache.has(rid)) return agencyDescCache.get(rid);

    const out = [];
    const stack = [rid];
    const seen = new Set();

    while (stack.length) {
      const cur = stack.pop();
      if (seen.has(cur)) continue;
      seen.add(cur);
      out.push(cur);

      const kids = agencyChildrenById.get(cur) || [];
      for (const k of kids) stack.push(String(k));
    }

    agencyDescCache.set(rid, out);
    return out;
  }

  function setSelectedAgency(idOrNull) {
    selectedAgencyId = idOrNull ? String(idOrNull) : null;

    if (!selectedAgencyId) {
      selectedAgencyScopeIds = null;
      return;
    }

    // Parent-aware: include selected + all descendants
    selectedAgencyScopeIds = new Set(getDescendantsInclusive(selectedAgencyId));
  }

  // Optional: if a child agency has no logo, walk up to the parent until you find one
  function getAgencyLogoFor(id) {
    let cur = id ? String(id) : null;
    while (cur) {
      if (AGENCY_LOGOS[cur]) return AGENCY_LOGOS[cur];
      cur = agencyParentById.get(cur) || null;
    }
    return null;
  }

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

  // Decode HTML entities that may already be encoded in source data (e.g. &amp; → &)
  function decodeHtmlEntities(s) {
    const txt = document.createElement("textarea");
    txt.innerHTML = String(s ?? "");
    return txt.value;
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&",  "&amp;")
      .replaceAll("<",  "&lt;")
      .replaceAll(">",  "&gt;")
      .replaceAll('"',  "&quot;")
      .replaceAll("'",  "&#039;");
  }

  function getAgencyName(agencyId) {
    if (!agencyId && agencyId !== 0) return null;
    return agencyNamesById.get(String(agencyId)) || null;
  }

  // Strips HTML tags; inserts spaces at block boundaries so words don't jam together
  function stripHtmlToText(html) {
    if (!html) return "";
    const spaced = String(html)
      .replace(/<\/(p|div|li|h[1-6]|section|article|tr|td|th)>/gi, " ")
      .replace(/<br\s*\/?>/gi, " ");
    const div = document.createElement("div");
    div.innerHTML = spaced;
    return (div.textContent || div.innerText || "").replace(/\s+/g, " ").trim();
  }

  // Fixes plain text spacing and splits numbered list items (1) 2) 3) into paragraphs
  function fixSpacing(text) {
    if (!text) return "";
    // Fix missing spaces at sentence boundaries
    text = text.replace(/([.!?])([A-Z])/g, "$1 $2");
    // Only split on "N)" when it looks like a list item start:
    // must be at start of string, or preceded by ". " (end of previous sentence)
    // NOT when preceded by "(" like "Division B (3)" or mid-number like "117-159)"
    text = text.replace(/(^|\. )(\d+\))/g, "$1\n$2");
    return text.trim();
  }

  /* ─────────────────────────────────────────────
     MERGE: list record + detail record
     Detail JSON only has opp_id, description, url —
     spreading is safe, no risk of clobbering eligibility
     or any other list fields.
  ───────────────────────────────────────────── */
  function mergedOpp(base) {
    const detail = detailsById.get(String(base?.opp_id ?? "")) || {};
    return { ...base, ...detail };
  }

  /* ─────────────────────────────────────────────
     FILTER PREDICATES
  ───────────────────────────────────────────── */
  // OPEN = no due date, or due date is today or in the future
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

  // Parent/child-aware agency filter (includes descendants)
    function matchesAgency(o) {
    if (!selectedAgencyScopeIds) return true;
    return selectedAgencyScopeIds.has(String(o.agency_id));
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

  // Agency logos — keyed by agency_id, path relative to project root
  // Filename must match exactly what's in your agencies/ folder
  const AGENCY_LOGOS = {
    // ── High-volume agencies ──
    "1":   "images/agencies/NIH_Logo.png",                                         // Office HHS-NIH11 (431 opps)
    "7":   "images/agencies/U.S. National Science Foundation.png",                 // NSF (189 opps)
    "38":  "images/agencies/Environmental Protection Agency.png",                  // EPA (12 opps)
    "35":  "images/agencies/Department of Housing and Urban Development.png",      // HUD (6 opps)
    "67":  "images/agencies/Department of Commerce.png",                           // Dept of Commerce (8 opps)

    // ── DARPA (all sub-offices share the same logo) ──
    "42":  "images/agencies/DARPA_Logo.png",
    "71":  "images/agencies/DARPA_Logo.png",
    "85":  "images/agencies/DARPA_Logo.png",
    "158": "images/agencies/DARPA_Logo.png",
    "382": "images/agencies/DARPA_Logo.png",
    "432": "images/agencies/DARPA_Logo.png",
    "613": "images/agencies/DARPA_Logo.png",
    "661": "images/agencies/DARPA_Logo.png",
    "672": "images/agencies/DARPA_Logo.png",
    "692": "images/agencies/DARPA_Logo.png",

    // ── Other departments ──
    "2":   "images/agencies/Department of Energy.png",
    "5":   "images/agencies/Department of Justice.png",
    "8":   "images/agencies/Department of State.png",
    "12":  "images/agencies/Department of Transportation.png",
    "20":  "images/agencies/Department of Defense.png",
    "22":  "images/agencies/Department of the Interior.png",
    "25":  "images/agencies/National Aeronautics and Space Administration.png",
    "29":  "images/agencies/DOL_Logo.png",
    "45":  "images/agencies/DOL_Logo.png",
    "46":  "images/agencies/Department of Education.png",
    "55":  "images/agencies/Department of Veterans Affairs.png",
    "60":  "images/agencies/National Endowment for the Humanities.png",
    "79":  "images/agencies/Department of Homeland Security.png",
    "86":  "images/agencies/Department of Energy.png",
    "99":  "images/agencies/DOL_Logo.png",
    "104": "images/agencies/Office of National Drug Control Policy.png",
    "124": "images/agencies/ONR_Logo.png",
    "185": "images/agencies/Department of the Treasury.png",
    "189": "images/agencies/National Archives and Records Administration.png",
    "226": "images/agencies/Millennium Challenge Corporation.png",
    "522": "images/agencies/Millennium Challenge Corporation.png",
    "563": "images/agencies/ONR_Logo.png",
  };

  function renderAgencyBanner() {
    const banner = $("agency-banner");
    if (!banner) return;
    if (!selectedAgencyId) { banner.innerHTML = ""; banner.style.display = "none"; return; }

    const name    = agencyNamesById.get(String(selectedAgencyId)) || `Agency ${selectedAgencyId}`;
    const logoSrc = getAgencyLogoFor(String(selectedAgencyId));

    banner.style.display = "";
    banner.innerHTML = logoSrc
      ? `<img src="${logoSrc}" alt="${escapeHtml(name)} logo" class="agency-banner-logo">
         <span class="agency-banner-name">${escapeHtml(name)}</span>`
      : `<span class="agency-banner-name">${escapeHtml(name)}</span>`;
  }


  /* ─────────────────────────────────────────────
     SIDEBAR: funding buckets + agency list
     Built dynamically from live data after load.
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

    // Only count/filter OPEN opportunities in the sidebar
    const openOpps = listOpps.filter(isOpenOpportunity);

    // Count OPEN opportunities per *direct* agency_id
    const directCounts = new Map();
    openOpps.forEach((o) => {
      const id = String(o.agency_id ?? "");
      if (!id) return;
      directCounts.set(id, (directCounts.get(id) || 0) + 1);
    });

    // Parent-aware aggregate: count(id) = direct(id) + sum(direct(descendants))
    function aggregateCountForAgency(id) {
      const key = String(id ?? "");
      if (!key) return 0;

      const ids =
          agencyChildrenById && agencyChildrenById.size > 0
              ? getDescendantsInclusive(key)
              : [key];

      let sum = 0;
      for (const d of ids) sum += directCounts.get(String(d)) || 0;
      return sum;
    }

    // Resolve display name (no internal ID-only labels)
    function getAgencyName(id) {
      const key = String(id ?? "");
      const a = agencyById?.get(key);
      return (a && (a.name || a.agency_name)) ? String(a.name || a.agency_name) : "Unknown agency";
    }

    // Build a parent/child-aware HTML tree (parents + indented children)
    function buildAgencyTreeHtml() {
      const allAgencies =
        (agenciesRaw && agenciesRaw.length)
          ? agenciesRaw
          : Array.from(directCounts.keys()).map((id) => ({ agency_id: id, parent_id: null, name: getAgencyName(id) }));

      const getId = (a) => String(a.agency_id ?? a.id ?? "");
      const getParentId = (a) => {
        const p = a.parent_id ?? a.parentId ?? a.parent ?? null;
        return p == null || p === "" ? null : String(p);
      };
      const getName = (a) => String(a.name ?? a.agency_name ?? getAgencyName(getId(a)) ?? "");

      // Parents are nodes whose parent_id is null OR points to a missing node
      const allIds = new Set(allAgencies.map(getId).filter(Boolean));
      const parents = allAgencies
        .filter((a) => {
          const pid = getParentId(a);
          return pid == null || !allIds.has(pid);
        })
        .map((a) => ({ id: getId(a), name: getName(a) }))
        .filter((a) => a.id);

      // Sort parents by subtree count desc
      parents.sort((a, b) => {
        const da = aggregateCountForAgency(a.id);
        const db = aggregateCountForAgency(b.id);
        return db - da || a.name.localeCompare(b.name);
      });

      const renderNode = (id, name, depth) => {
        const count = aggregateCountForAgency(id);
        if (!count) return "";

        const childIds = agencyChildrenById?.get(String(id)) || [];
        const children = childIds
          .map((cid) => {
            const key = String(cid);
            return { id: key, name: getAgencyName(key), count: aggregateCountForAgency(key) };
          })
          .filter((c) => c.count > 0)
          .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

        const hasChildren = children.length > 0;
        const checked = String(selectedAgencyId ?? "") === String(id) ? "checked" : "";

        const depthClass =
          depth === 0 ? "agency-parent" :
          depth === 1 ? "agency-child" :
          "agency-grandchild";

        // Only parents get a caret. Parents start collapsed by default.
        const caret = (depth === 0 && hasChildren)
          ? `<button class="agency-toggle" type="button" aria-label="Toggle child agencies" aria-expanded="false"></button>`
          : `<span style="width:18px;display:inline-block"></span>`;

        const collapsedClass = (depth === 0 && hasChildren) ? "is-collapsed" : "";

        return `
          <li class="agency-node ${collapsedClass}"
              data-agency-entry="${escapeHtml(id)}"
              data-agency-name="${escapeHtml(String(name).toLowerCase())}">
            <label class="filter-option ${depthClass} ${collapsedClass}">
              ${caret}
              <input type="radio" name="agency-select" value="${escapeHtml(id)}" ${checked}>
              <span class="filter-label agency-name">${escapeHtml(name)}</span>
              <span class="filter-count">${count.toLocaleString()}</span>
            </label>
    
            ${hasChildren ? `
              <ul class="agency-children">
                ${children.map((c) => renderNode(c.id, c.name, depth + 1)).join("")}
              </ul>
            ` : ``}
          </li>
        `;
      };

      return parents.map((p) => renderNode(p.id, p.name, 0)).join("");
    }

    // ---- Render sidebar HTML ----
    els.sidebar.innerHTML = `
        <!-- FUNDING FILTER -->
        <div class="filter-section">
        <h3 class="filter-heading">Award Amount</h3>
        <ul class="filter-list" id="funding-filter-list">
            ${FUNDING_BUCKETS.map((b, i) => {
      const count =
          i === 0
              ? openOpps.length
              : openOpps.filter((o) => {
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
                </li>
            `;
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
            <li data-agency-entry="" data-agency-name="all agencies">
            <label class="filter-option ${!selectedAgencyId ? "active" : ""}">
                <input type="radio" name="agency-select" value="" ${!selectedAgencyId ? "checked" : ""}>
                <span class="filter-label agency-name">All agencies</span>
                <span class="filter-count">${openOpps.length.toLocaleString()}</span>
            </label>
            </li>

            ${buildAgencyTreeHtml()}
        </ul>
        </div>
    `;

    // ---- Funding listeners ----
    els.sidebar.querySelectorAll('input[name="funding-range"]').forEach((radio) => {
      radio.addEventListener("change", () => {
        const b = FUNDING_BUCKETS[Number(radio.value)];
        fundingMin = b.min;
        fundingMax = b.max;

        selectedOppId = null;
        visibleCount = PAGE_SIZE;

        els.sidebar
            .querySelectorAll("#funding-filter-list .filter-option")
            .forEach((l) => l.classList.remove("active"));
        radio.closest(".filter-option")?.classList.add("active");

        showListView();
      });
    });
    // ---- Parent expand/collapse (caret) ----
    els.sidebar.querySelectorAll(".agency-node > label .agency-toggle").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();

        const node = btn.closest(".agency-node");
        if (!node) return;

        const isCollapsed = node.classList.toggle("is-collapsed");
        // Update aria state + caret visual
        btn.setAttribute("aria-expanded", String(!isCollapsed));

        // Also toggle the row class so caret switches ▾ / ▸ via CSS
        const row = node.querySelector(":scope > .filter-option");
        row?.classList.toggle("is-collapsed", isCollapsed);
      });
    });
    // ---- Agency listeners (parent/child aware selection) ----
    els.sidebar.querySelectorAll('input[name="agency-select"]').forEach((radio) => {
      radio.addEventListener("change", () => {
        // IMPORTANT: use the helper so parent/child selection stays consistent
        if (typeof setSelectedAgency === "function") {
          setSelectedAgency(radio.value || null);
        } else {
          selectedAgencyId = radio.value || null;
        }

        selectedOppId = null;
        visibleCount = PAGE_SIZE;

        els.sidebar
            .querySelectorAll("#agency-filter-list .filter-option")
            .forEach((l) => l.classList.remove("active"));
        radio.closest(".filter-option")?.classList.add("active");

        showListView();
        renderAgencyBanner?.();
      });
    });

    // ---- Agency search box ----
    $("agency-search")?.addEventListener("input", (e) => {
      const q = String(e.target.value || "").trim().toLowerCase();
      const nodes = Array.from(els.sidebar.querySelectorAll("#agency-filter-list .agency-node"));

      // Reset view
      if (!q) {
        nodes.forEach((node) => {
          node.style.display = "";
          // collapse parents back to default
          if (node.querySelector(":scope > .agency-children")) {
            node.classList.add("is-collapsed");
            const row = node.querySelector(":scope > .filter-option");
            row?.classList.add("is-collapsed");
            const btn = node.querySelector(":scope > .filter-option .agency-toggle");
            btn?.setAttribute("aria-expanded", "false");
          }
        });
        return;
      }

      // First pass: hide everything
      nodes.forEach((node) => {
        node.style.display = "none";
      });

      // Second pass: show matching nodes + ancestors; expand ancestors
      nodes.forEach((node) => {
        const name = (node.getAttribute("data-agency-name") || "");
        const isMatch = name.includes(q);

        // Also treat as match if any visible descendant matches
        const descendantMatch = !!node.querySelector(`.agency-node[data-agency-name*="${CSS.escape(q)}"]`);

        if (isMatch || descendantMatch) {
          // show this node
          node.style.display = "";

          // if a descendant matches, expand this node so children are visible
          if (descendantMatch) {
            node.classList.remove("is-collapsed");
            const row = node.querySelector(":scope > .filter-option");
            row?.classList.remove("is-collapsed");
            const btn = node.querySelector(":scope > .filter-option .agency-toggle");
            btn?.setAttribute("aria-expanded", "true");
          }

          // show + expand ancestors
          let parent = node.parentElement?.closest(".agency-node");
          while (parent) {
            parent.style.display = "";
            parent.classList.remove("is-collapsed");
            const prow = parent.querySelector(":scope > .filter-option");
            prow?.classList.remove("is-collapsed");
            const pbtn = parent.querySelector(":scope > .filter-option .agency-toggle");
            pbtn?.setAttribute("aria-expanded", "true");
            parent = parent.parentElement?.closest(".agency-node");
          }
        }
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
      renderAgencyBanner();
    },
  };

  /* ─────────────────────────────────────────────
     RENDER: CARD LIST
  ───────────────────────────────────────────── */
  function renderList() {
    if (!els.list) return;
    const arr = getFilteredAndSorted();

    // Total opportunity count — needs <p id="opportunity-total-count"></p> in HTML (Andrew)
    if (els.totalCount) {
      els.totalCount.textContent =
        arr.length === 1 ? "1 open opportunity" : `${arr.length.toLocaleString()} open opportunities`;
    }

    els.list.classList.add("grid");

    if (arr.length === 0) {
      els.list.innerHTML = `<p class="no-results">No opportunities match your filters.</p>`;
      return;
    }

    // opp_id / agency_id / category_id intentionally NOT rendered in UI
    els.list.innerHTML = arr.slice(0, visibleCount).map(o => {
      const id       = String(o.opp_id ?? "");
      const selected = id === String(selectedOppId);
      return `
        <button class="opportunity-card${selected ? " selected" : ""}"
                data-opp-id="${escapeHtml(id)}" type="button">
          <div class="opp-title">${escapeHtml(decodeHtmlEntities(o.title || "(Untitled)"))}</div>
          <div class="opp-meta">
            <span><strong>Posted:</strong> ${fmtDate(parseDateMaybe(o.post_date))}</span>
            <span><strong>Due:</strong> ${fmtDate(parseDateMaybe(o.due_date))}</span>
          </div>
        </button>`;
    }).join("");

    els.list.querySelectorAll(".opportunity-card").forEach(card => {
      card.addEventListener("click", () => {
        selectedOppId = card.getAttribute("data-opp-id");
        showDetailView();
      });
    });

    // Remove any existing load-more outside the grid
    els.list.parentNode?.querySelector(".load-more-wrap")?.remove();

    if (arr.length > visibleCount) {
      const remaining = Math.min(PAGE_SIZE, arr.length - visibleCount);
      // Insert after the grid, not inside it, so grid-auto-rows doesn't stretch it
      els.list.insertAdjacentHTML("afterend", `
        <div class="load-more-wrap">
          <button class="load-more-btn" type="button">Load more (${remaining} more)</button>
        </div>`);
      els.list.nextElementSibling?.querySelector(".load-more-btn")?.addEventListener("click", () => {
        visibleCount += PAGE_SIZE;
        renderList();
      });
    }
  }

  function buildDescHtml(desc, oppId) {
    if (!desc) return "<p>N/A</p>";
    const paragraphs = desc.split("\n").filter(s => s.trim());
    const full = paragraphs.map(s => "<p>" + escapeHtml(s.trim()) + "</p>").join("");
    if (desc.length <= 600) return full;
    let charCount = 0;
    const shortParas = [];
    for (const p of paragraphs) {
      if (charCount >= 600) break;
      shortParas.push("<p>" + escapeHtml(p.trim()) + "</p>");
      charCount += p.length;
    }
    const shortHtml = shortParas.join("");
    const id = "desc-" + String(oppId);
    return (
      "<div id=\"" + id + "-short\">" + shortHtml +
        "<button class=\"desc-toggle-btn\" onclick=\"" +
          "document.getElementById('" + id + "-short').style.display='none';" +
          "document.getElementById('" + id + "-full').style.display='';" +
        "\">Show full description ↓</button>" +
      "</div>" +
      "<div id=\"" + id + "-full\" style=\"display:none\">" + full +
        "<button class=\"desc-toggle-btn\" onclick=\"" +
          "document.getElementById('" + id + "-full').style.display='none';" +
          "document.getElementById('" + id + "-short').style.display='';" +
        "\">Show less ↑</button>" +
      "</div>"
    );
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

    // description comes from detail JSON
    const desc = fixSpacing(stripHtmlToText(normalizeNull(opp.description) || ""));

    // eligibility comes from list JSON
    const eligibilityRaw = normalizeNull(opp.eligibility);
    const eligParsed =
      Array.isArray(eligibilityRaw)      ? eligibilityRaw :
      typeof eligibilityRaw === "string" ? safeJsonParse(eligibilityRaw) : null;
    const eligNames = Array.isArray(eligParsed)
      ? eligParsed.map(e => e?.applicant_type_name).filter(Boolean) : [];

    // opp_id / agency_id / category_id intentionally NOT rendered in UI
    const agencyName = getAgencyName(opp.agency_id);
    els.details.innerHTML = `
      <div class="opp-details-card">
        <button class="back-btn" id="detail-back-btn" type="button">
          ← Back to results
        </button>
        ${agencyName ? `<div class="opp-detail-agency">${escapeHtml(agencyName)}</div>` : ""}
        <h2>${escapeHtml(decodeHtmlEntities(opp.title || "(Untitled)"))}</h2>
        <p><strong>Posted:</strong> ${fmtDate(parseDateMaybe(opp.post_date))}</p>
        <p><strong>Due:</strong> ${fmtDate(parseDateMaybe(opp.due_date))}</p>
        <hr />
        <p><strong>Award ceiling:</strong> ${moneyMaybe(opp.award_ceiling)}</p>
        <p><strong>Award floor:</strong> ${moneyMaybe(opp.award_floor)}</p>
        <p><strong>Estimated funding:</strong> ${moneyMaybe(opp.estimated_funding)}</p>
        ${url ? `<p><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">View opportunity ↗</a></p>` : ""}
        <hr />
        <p><strong>Description:</strong></p>
        ${buildDescHtml(desc, selectedOppId)}
        <p><strong>Eligibility:</strong></p>
        ${eligNames.length
          ? `<ul>${eligNames.map(x => `<li>${escapeHtml(x)}</li>`).join("")}</ul>`
          : `<p>N/A</p>`}
      </div>
    `;

    $("detail-back-btn")?.addEventListener("click", showListView);
  }

  /* ─────────────────────────────────────────────
     EVENT LISTENERS
  ───────────────────────────────────────────── */
  els.search?.addEventListener("input", () => {
    showListView();
  });

  els.sort?.addEventListener("change", () => {
    visibleCount = PAGE_SIZE;
    renderList();
  });

  // Keyboard: Escape goes back to list
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && els.detailView?.style.display !== "none") {
      showListView();
    }
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

      // Load detail JSON (opp_id, description, url ONLY — no overlapping fields)
      const detRes = await fetch(DETAILS_URL, { cache: "no-store" });
      if (!detRes.ok) throw new Error(`Failed to fetch details: ${DETAILS_URL} (${detRes.status})`);
      const details = await detRes.json();
      if (!Array.isArray(details)) throw new Error(`Details file must be a JSON array: ${DETAILS_URL}`);
      detailsById = new Map(details.map(d => [String(d.opp_id), d]));

      selectedOppId = null;
      buildSidebar();
      renderAgencyBanner();
      showListView();

      // Load agency names (non-blocking — sidebar shows "Agency N" placeholders until this resolves)
      fetch("data/agency.json", { cache: "no-store" })
        .then(r => r.ok ? r.json() : Promise.reject())
        .then(agencies => {
          buildAgencyHierarchy(agencies);

          agencyById = new Map(agencies.map(a => [String(a.id), a]));
          agencyNamesById = new Map(agencies.map(a => [String(a.id), a.name]));

          const nameMap = Object.fromEntries(agencyNamesById);
          window.OpportunityFilter.applyAgencyNames(nameMap);

          // Re-render so agency names appear
          buildSidebar();           // <-- important: rebuild sidebar now that names exist
          renderAgencyBanner();

        if (els.detailView?.style.display === "none") {
            renderList();
        } else {
            renderDetails();
        }
        })
        .catch(() => { /* agencies.json not yet delivered — placeholders remain */ });
    } catch (e) {
      console.error("[opportunity.js]", e);
      if (els.list) els.list.innerHTML = `<p class="error-msg">Failed to load opportunities. Please try again.</p>`;
      if (els.details) els.details.innerHTML = "";
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();