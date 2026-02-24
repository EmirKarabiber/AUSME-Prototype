// js/pages/home.js
import { dataService } from '../services/dataService.js';
import { Logic } from '../utils/logic.js';
import { UIManager } from '../ui/uiManager.js';
import { AutocompleteManager } from '../ui/autocomplete.js';
import { debounce } from '../utils/debounce.js';

class HomeApp {
    async init() {
        await dataService.loadExperts();

        // Initial Render
        this.refreshHome(true);

        this.initFilters();
        this.initEvents();
    }

    initFilters() {
        const experts = dataService.getExperts();

        // Group departments by college
        const collegeMap = {};
        experts.forEach(e => {
            if (!e.college) return;
            if (!collegeMap[e.college]) collegeMap[e.college] = new Set();
            if (e.department) collegeMap[e.college].add(e.department);
        });

        const nestedColleges = Object.keys(collegeMap).sort().map(college => ({
            name: college,
            children: [...collegeMap[college]].sort()
        }));

        const degrees = [...new Set(experts.map(e => e.degree).filter(Boolean))].sort();

        // Use event delegation on the `.filters` sidebar instead of individual bindings
        const sidebar = document.querySelector('.filters');
        if (sidebar) {
            sidebar.addEventListener('change', (e) => {
                if (e.target.classList.contains('filter-cb')) {
                    // Toggle nested checkboxes visibility if it's a parent
                    if (e.target.classList.contains('parent-cb')) {
                        const nestedDiv = e.target.closest('.checkbox-visual').querySelector('.nested-checkboxes');
                        if (nestedDiv) {
                            nestedDiv.style.display = e.target.checked ? 'block' : 'none';
                        }
                    }
                    this.refreshHome();
                }
            });
        }

        UIManager.renderNestedCheckboxes(nestedColleges, 'collegeCheckboxes', 'col', 'dep');
        UIManager.renderCheckboxes(degrees, 'degreeCheckboxes', 'deg');
    }

    initEvents() {
        new AutocompleteManager(
            'searchInput',
            'searchGhost',
            'searchSuggestions',
            () => dataService.getExperts().map(e => e.name),
            () => this.refreshHome()
        );

        const sortSelect = UIManager.el('sortSelect');
        if (sortSelect) sortSelect.addEventListener('change', () => this.refreshHome());

        const timeSlider = UIManager.el('recencyStartYearRange');
        if (timeSlider) timeSlider.addEventListener('input', () => this.refreshHome());

        const citationInput = UIManager.el('citationInput');
        // Debounce the number input to prevent spammy rerenders while typing "100"
        if (citationInput) {
            const debouncedRefresh = debounce(() => this.refreshHome(), 300);
            citationInput.addEventListener('input', debouncedRefresh);
        }

        const clearTop = UIManager.el('clearFiltersTop');
const clearBottom = UIManager.el('clearFiltersBottom');

if (clearTop) clearTop.addEventListener('click', () => this.clearFilters());
if (clearBottom) clearBottom.addEventListener('click', () => this.clearFilters());
    }

    get state() {
        return {
            search: UIManager.val('searchInput'),
            colleges: UIManager.getchecked('collegeCheckboxes', 'col'),
            degrees: UIManager.getchecked('degreeCheckboxes'),
            departments: UIManager.getchecked('collegeCheckboxes', 'dep'),
            minCitations: UIManager.num('citationInput'),
            recencyYear: parseInt(UIManager.el('recencyStartYearRange') ? UIManager.el('recencyStartYearRange').value : 1999)
        };
    }

    refreshHome() {
        const allExperts = dataService.getExperts();
        const state = this.state;

        const filtered = Logic.filterExperts(allExperts, state);
        const sorted = Logic.sortData(filtered, UIManager.val('sortSelect') || 'name_asc', state.recencyYear);

        UIManager.renderExperts(sorted, state.recencyYear);
    }
    clearFilters() {

    // Uncheck all checkboxes
    document.querySelectorAll('.filters input[type="checkbox"]')
        .forEach(cb => cb.checked = false);

    // Reset citation input
    const citationInput = UIManager.el('citationInput');
    if (citationInput) citationInput.value = 0;

    // Reset time slider
    const range = UIManager.el('recencyStartYearRange');
    if (range) {
        range.value = 1999;
        const label = UIManager.el('recencyLabel');
        if (label) label.innerText = 'All Time';
    }

    // Clear search
    const searchInput = UIManager.el('searchInput');
    if (searchInput) searchInput.value = '';

    const ghost = UIManager.el('searchGhost');
    if (ghost) ghost.value = '';

    // Collapse nested departments
    document.querySelectorAll('.nested-checkboxes')
        .forEach(div => div.style.display = 'none');

    // Refresh results
    this.refreshHome();
}
}

// Bootstrap
document.addEventListener('DOMContentLoaded', () => {
    new HomeApp().init();
});
