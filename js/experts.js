// Role B3: JavaScript Logic Owner
// Refactored for Modularity: Separating Data, Logic, and UI

// ==========================================
// 1. DATA LAYER (Service)
// ==========================================
const DataService = {
  experts: [],
  expertDetails: {},

  async loadExperts() {
    try {
      const response = await fetch('data/experts.json');
      this.experts = await response.json();
    } catch (error) {
      console.error("Failed to load experts:", error);
    }
  },

  async loadExpertDetails() {
    try {
      const response = await fetch('data/expert_details.json');
      this.expertDetails = await response.json();
    } catch (error) {
      console.error("Failed to load expert details:", error);
    }
  },

  getExperts() {
    return this.experts;
  },

  getExpertByAuid(auid) {
    // Return details if available, otherwise partial from list
    return this.expertDetails[auid];
  },

  getPapersByAuid(auid) {
    const details = this.expertDetails[auid];
    return details ? details.publications : [];
  }
};

// ==========================================
// 2. BUSINESS LOGIC (Pure Functions)
// ==========================================
const Logic = {
  CURRENT_YEAR: 2026,
  ALL_TIME_YEAR: 1999, // Threshold for "All Time"

  // Metric Calculations

  // Calculates total citations received in years >= startYear
  calculateCitationsSince(obj, startYear) {
    // If All Time is selected, return total citations
    if (startYear <= this.ALL_TIME_YEAR) {
      return (obj.totalCitations || obj.total_citations || 0);
    }

    let total = 0;
    // Check for citationsPerYear (Expert) or citation_per_year (Paper)
    const cpy = obj.citationsPerYear || obj.citation_per_year;

    if (!cpy) return 0;

    // Handle Array format (Paper: [{year: 2024, citations: 5}])
    if (Array.isArray(cpy)) {
      cpy.forEach(entry => {
        if (entry.year >= startYear) {
          total += (entry.citations || 0);
        }
      });
    }
    // Handle Object format (Expert: {"2024": 50})
    else if (typeof cpy === 'object') {
      Object.keys(cpy).forEach(year => {
        if (parseInt(year) >= startYear) {
          total += (cpy[year] || 0);
        }
      });
    }

    return total;
  },

  // Expert Filtering
  filterExperts(experts, criteria) {
    return experts.filter(expert => {
      const fullText = `${expert.name} ${expert.title} ${expert.college} ${expert.department}`.toLowerCase();
      const matchesSearch = !criteria.search || fullText.includes(criteria.search);
      const matchesCollege = criteria.colleges.length === 0 || criteria.colleges.includes(expert.college);
      const matchesDegree = criteria.degrees.length === 0 || criteria.degrees.includes(expert.degree);

      // Filter by "Min Citations" in the selected Time Period
      // The criteria.minCitations applies to the EFFECTIVE count (All Time or Since X)
      const effectiveCitations = this.calculateCitationsSince(expert, criteria.recencyYear);
      const matchesCitations = effectiveCitations >= criteria.minCitations;

      return matchesSearch && matchesCollege && matchesDegree && matchesCitations;
    });
  },

  // Paper Filtering
  filterPapers(papers, criteria) {
    return papers.filter(p => {
      const pubYear = p.publication_date ? parseInt(p.publication_date.substring(0, 4)) : 0;
      const textMatch = (p.title || '').toLowerCase().includes(criteria.search);

      const yearMatch = pubYear >= criteria.startYear && pubYear <= criteria.endYear;

      // Filter by "Min Citations" in the selected Time Period
      const effectiveCitations = this.calculateCitationsSince(p, criteria.recencyYear);
      const matchesCitations = effectiveCitations >= criteria.minCitations;

      return textMatch && yearMatch && matchesCitations;
    });
  },

  // Generic Sorting
  sortData(data, sortType, recencyYear = 1999) {
    return [...data].sort((a, b) => { // Return new array
      switch (sortType) {
        case 'relevance': return 0; // Default order
        case 'name_asc': return (a.name || a.title).localeCompare(b.name || b.title);
        case 'citations':
          const citA = this.calculateCitationsSince(a, recencyYear);
          const citB = this.calculateCitationsSince(b, recencyYear);
          return citB - citA;
        case 'year_desc':
          const yA = a.publication_date ? new Date(a.publication_date).getTime() : 0;
          const yB = b.publication_date ? new Date(b.publication_date).getTime() : 0;
          return yB - yA;
        case 'year_asc':
          const yA2 = a.publication_date ? new Date(a.publication_date).getTime() : 0;
          const yB2 = b.publication_date ? new Date(b.publication_date).getTime() : 0;
          return yA2 - yB2;
        default: return 0;
      }
    });
  }
};

// ==========================================
// 3. UI LAYER (DOM Manipulation)
// ==========================================
const UIManager = {
  // Helpers
  el(id) { return document.getElementById(id); },
  val(id) { return this.el(id) ? (this.el(id).value || '').toLowerCase() : ''; },
  num(id) { return parseInt(this.el(id) ? this.el(id).value : 0) || 0; },

  getchecked(containerId) {
    const container = this.el(containerId);
    if (!container) return [];
    return Array.from(container.querySelectorAll('input:checked')).map(cb => cb.value);
  },

  // NOTE: syncSlider is removed/deprecated for citations as requested. 
  // Kept only if needed for other things, but here we just attach directly.

  // Rendering
  renderExperts(experts, recencyYear) {
    const container = this.el('expertsList');
    if (!container) return; // Guard for wrong page

    if (experts.length === 0) {
      container.innerHTML = '<p>No experts match your filters.</p>';
      return;
    }

    container.innerHTML = experts.map(expert => {
      const effective = Logic.calculateCitationsSince(expert, recencyYear);
      const label = recencyYear <= 1999 ? "Total Cited" : `Citations Since ${recencyYear}`;
      return `
            <div class="card expert-card" onclick="window.location.href='papers.html?auid=${expert.id}'">
                <h3>${expert.name}</h3>
                <p><strong>Title:</strong> ${expert.title}</p>
                <p><strong>College:</strong> ${expert.college}</p>
                <p style="font-size:0.8em; color:#666;">${expert.degree}</p>
                <div class="stats">
                    <span style="font-weight:bold; color:#2980b9;">${label}: ${effective}</span>
                </div>
                <button class="view-papers-btn">View Papers</button>
            </div>`;
    }).join('');
  },

  renderPapers(papers, recencyYear) {
    const container = this.el('papersList');
    if (!container) return; // Guard for wrong page

    if (papers.length === 0) {
      container.innerHTML = '<p>No papers match your filters.</p>';
      return;
    }

    container.innerHTML = papers.map(paper => {
      const effective = Logic.calculateCitationsSince(paper, recencyYear);
      const label = recencyYear <= 1999 ? "Cited by" : `Citations Since ${recencyYear}`;
      const yearStr = paper.publication_date ? paper.publication_date.substring(0, 4) : 'N/A';

      return `
            <div class="card paper-card" style="margin-bottom: 15px;">
                <div style="display:flex; justify-content:space-between; align-items:start;">
                    <h4 style="margin:0 0 5px 0; color:#333;">${paper.title}</h4>
                    <span style="background:#eaf2f8; padding:2px 8px; border-radius:10px; font-size:0.8em; color:#2980b9;">${yearStr}</span>
                </div>
                <p class="meta" style="margin:5px 0;">${label}: ${effective}</p>
                <p class="authors" style="font-size:0.9em;">${paper.authors_display || paper.authors || ''}</p>
                ${paper.published_in ? `<p style="font-size:0.8em; color:#666;">Published in: ${paper.published_in}</p>` : ''}
            </div>`;
    }).join('');
  },

  renderCheckboxes(items, containerId, namePrefix, callbackFunc) {
    const container = this.el(containerId);
    if (!container) return;

    container.innerHTML = items.map(item => `
            <div class="checkbox-visual">
                <input type="checkbox" value="${item}" id="${namePrefix}_${item.replace(/[^a-zA-Z0-9]/g, '')}" class="filter-cb">
                <label for="${namePrefix}_${item.replace(/[^a-zA-Z0-9]/g, '')}">${item}</label>
            </div>
        `).join('');

    // Attach listeners dynamically
    container.querySelectorAll('.filter-cb').forEach(cb => {
      cb.addEventListener('change', callbackFunc);
    });
  }
};

// ==========================================
// 4. CONTROLLER (Orchestrator)
// ==========================================
const App = {
  async init() {
    // Router: simple check for elements
    if (UIManager.el('expertsList')) {
      await DataService.loadExperts();
      this.initHome();
    } else if (UIManager.el('papersList')) {
      await DataService.loadExpertDetails();
      this.initProfile();
    }
  },

  // --- HOME PAGE ---
  initHome() {
    const experts = DataService.getExperts();

    // 1. Render initial state (Default to All Time = 1999)
    UIManager.renderExperts(experts, 1999);

    // 2. Populate Filters
    const colleges = [...new Set(experts.map(e => e.college).filter(Boolean))].sort();
    const degrees = [...new Set(experts.map(e => e.degree).filter(Boolean))].sort();

    UIManager.renderCheckboxes(colleges, 'collegeCheckboxes', 'col', () => this.refreshHome());
    UIManager.renderCheckboxes(degrees, 'degreeCheckboxes', 'deg', () => this.refreshHome());

    // 3. Attach Events
    UIManager.el('searchInput').addEventListener('input', () => this.refreshHome());
    UIManager.el('sortSelect').addEventListener('change', () => this.refreshHome());

    // Time Period slider
    const timeSlider = UIManager.el('recencyStartYearRange');
    if (timeSlider) {
      timeSlider.addEventListener('input', () => this.refreshHome());
    }

    // Min Citations Input (Direct listener, no sync)
    const citationInput = UIManager.el('citationInput');
    if (citationInput) {
      citationInput.addEventListener('input', () => this.refreshHome());
    }
  },

  refreshHome() {
    // If slider is not present, default to 1999 (All Time)
    const recencyYear = parseInt(UIManager.el('recencyStartYearRange') ? UIManager.el('recencyStartYearRange').value : 1999);

    const criteria = {
      search: UIManager.val('searchInput'),
      colleges: UIManager.getchecked('collegeCheckboxes'),
      degrees: UIManager.getchecked('degreeCheckboxes'),
      minCitations: UIManager.num('citationInput'), // Text input value
      recencyYear: recencyYear
    };

    let filtered = Logic.filterExperts(DataService.getExperts(), criteria);
    let sorted = Logic.sortData(filtered, UIManager.val('sortSelect'), recencyYear);

    UIManager.renderExperts(sorted, recencyYear);
  },

  // --- PROFILE PAGE ---
  initProfile() {
    const params = new URLSearchParams(window.location.search);
    const auid = params.get('auid');
    const expert = DataService.getExpertByAuid(auid);

    if (!expert) return;

    // 1. Header (Show All Time stats initially)
    const totalCited = expert.publications.reduce((sum, p) => sum + (p.total_citations || 0), 0);

    UIManager.el('expertHeader').innerHTML = `
            <div class="card profile-header" style="margin-bottom: 20px;">
                <h2 style="margin-top:0;">${expert.name}</h2>
                <p>${expert.title || ''}, ${expert.department || ''}</p>
                <p><strong>${expert.college || ''}</strong></p>
                <div style="margin-top:10px; font-weight:bold; color:#2980b9;">
                    Total Cited: ${totalCited}
                </div>
            </div>`;

    // 2. Initial Papers
    this.currentPapers = DataService.getPapersByAuid(auid);
    this.refreshProfile();

    // 3. Attach Events
    UIManager.el('paperSearchInput').addEventListener('input', () => this.refreshProfile());
    UIManager.el('paperSortSelect').addEventListener('change', () => this.refreshProfile());
    UIManager.el('yearStart').addEventListener('input', () => this.refreshProfile());
    UIManager.el('yearEnd').addEventListener('input', () => this.refreshProfile());

    // Time Period slider
    const paperTimeSlider = UIManager.el('paperRecencyStartYearRange');
    if (paperTimeSlider) {
      paperTimeSlider.addEventListener('input', () => this.refreshProfile());
    }

    // Min Citations Input
    const paperCitationInput = UIManager.el('paperCitationInput');
    if (paperCitationInput) {
      paperCitationInput.addEventListener('input', () => this.refreshProfile());
    }
  },

  refreshProfile() {
    const recencyYear = parseInt(UIManager.el('paperRecencyStartYearRange') ? UIManager.el('paperRecencyStartYearRange').value : 1999);

    const criteria = {
      search: UIManager.val('paperSearchInput'),
      minCitations: UIManager.num('paperCitationInput'),
      startYear: UIManager.num('yearStart') || 1900,
      endYear: UIManager.num('yearEnd') || 2100,
      recencyYear: recencyYear
    };

    let filtered = Logic.filterPapers(this.currentPapers, criteria);
    let sorted = Logic.sortData(filtered, UIManager.val('paperSortSelect'), recencyYear);

    UIManager.renderPapers(sorted, recencyYear);
  }
};

// Start App
App.init();
