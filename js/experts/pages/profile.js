// js/pages/profile.js
import { dataService } from '../services/dataService.js';
import { Logic } from '../utils/logic.js';
import { UIManager } from '../ui/uiManager.js';
import { debounce } from '../utils/debounce.js';

class ProfileApp {
    async init() {
    await dataService.loadExpertDetails();
    await dataService.loadSimilarProfiles();

    const params = new URLSearchParams(window.location.search);
    this.auid = params.get('auid');   // store it on the class

    const expert = dataService.getExpertByAuid(this.auid);

    if (!expert) return;

    this.currentPapers = dataService.getPapersByAuid(this.auid);

    this.renderHeader(expert);
    this.renderSimilarProfiles(this.auid);
    this.initEvents();

    this.refreshProfile();
}

   renderHeader(expert) {
    const totalCited = expert.publications.reduce(
        (sum, p) => sum + (p.total_citations || 0), 0
    );

    const expertId = this.auid;  // 🔥 correct source of ID
    const imgPath = `images/headshots/${expertId}.jpg`;

    UIManager.el('expertHeader').innerHTML = `
        <div class="card profile-header">

            <div class="profile-headshot">
                <img 
                    src="${imgPath}" 
                    alt="${expert.name}"
                    onerror="this.onerror=null; this.src='images/headshots/default.jpg';"
                >
            </div>

            <div class="profile-info">
                <h2>${expert.name}</h2>
                <p>${expert.title || ''}, ${expert.department || ''}</p>
                <p><strong>${expert.college || ''}</strong></p>
                
                <div class="profile-citations">
                    Total Cited: ${totalCited}
                </div>
            </div>

        </div>
    `;
}

    renderSimilarProfiles(auid) {
        const similarAuids = dataService.getSimilarProfileAuids(auid).slice(0, 10);
        const similarEl = UIManager.el('similarProfiles');
        if (!similarEl) return;

        if (similarAuids.length === 0) {
            similarEl.innerHTML = '';
            similarEl.style.display = 'none';
        } else {
            similarEl.style.display = 'block';
            const links = similarAuids.map(similarAuid => {
    const similarExpert = dataService.getExpertByAuid(similarAuid);
    const name = similarExpert ? similarExpert.name : similarAuid;

    const imgPath = `images/headshots/${similarAuid}.jpg`;

    return `
        <a href="papers.html?auid=${encodeURIComponent(similarAuid)}"
           class="similar-profile-item">

            <div class="similar-img-wrapper">
                <img 
                    src="${imgPath}"
                    alt="${name}"
                    onerror="this.onerror=null; this.src='images/headshots/default.jpg';"
                >
            </div>

            <span class="similar-name">${name}</span>

        </a>
    `;
            }).join('');
            similarEl.innerHTML = `<label><strong>Similar researchers</strong></label><div class="similar-profiles-links">${links}</div>`;
        }
    }

    initEvents() {
        const debouncedRefresh = debounce(() => this.refreshProfile(), 300);

        const searchInput = UIManager.el('paperSearchInput');
        if (searchInput) searchInput.addEventListener('input', debouncedRefresh);

        const sortSelect = UIManager.el('paperSortSelect');
        if (sortSelect) sortSelect.addEventListener('change', () => this.refreshProfile());

        const yearStart = UIManager.el('yearStart');
        if (yearStart) yearStart.addEventListener('input', debouncedRefresh);

        const yearEnd = UIManager.el('yearEnd');
        if (yearEnd) yearEnd.addEventListener('input', debouncedRefresh);

        const timeSlider = UIManager.el('paperRecencyStartYearRange');
        if (timeSlider) timeSlider.addEventListener('input', () => this.refreshProfile());

        const citationInput = UIManager.el('paperCitationInput');
        if (citationInput) citationInput.addEventListener('input', debouncedRefresh);
    }

    get state() {
        return {
            search: UIManager.val('paperSearchInput'),
            minCitations: UIManager.num('paperCitationInput'),
            startYear: UIManager.num('yearStart') || 1900,
            endYear: UIManager.num('yearEnd') || 2100,
            recencyYear: parseInt(UIManager.el('paperRecencyStartYearRange') ? UIManager.el('paperRecencyStartYearRange').value : 1999)
        };
    }

    refreshProfile() {
        const state = this.state;
        const filtered = Logic.filterPapers(this.currentPapers, state);
        const sorted = Logic.sortData(filtered, UIManager.val('paperSortSelect') || 'year_desc', state.recencyYear);

        UIManager.renderPapers(sorted, state.recencyYear);
    }
}

// Bootstrap
document.addEventListener('DOMContentLoaded', () => {
    new ProfileApp().init();
});
