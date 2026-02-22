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
        const auid = params.get('auid');
        const expert = dataService.getExpertByAuid(auid);

        if (!expert) return;

        this.currentPapers = dataService.getPapersByAuid(auid);

        this.renderHeader(expert);
        this.renderSimilarProfiles(auid);
        this.initEvents();

        this.refreshProfile();
    }

    renderHeader(expert) {
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
                return `<a href="papers.html?auid=${encodeURIComponent(similarAuid)}" class="similar-profile-link">${name}</a>`;
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
