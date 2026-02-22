// js/ui/uiManager.js
import { Logic } from '../utils/logic.js';

export const UIManager = {
    el(id) { return document.getElementById(id); },
    val(id) { return this.el(id) ? (this.el(id).value || '').toLowerCase() : ''; },
    num(id) { return parseInt(this.el(id) ? this.el(id).value : 0) || 0; },

    getchecked(containerId, prefix = null) {
        const container = this.el(containerId);
        if (!container) return [];
        let selector = 'input:checked';
        if (prefix) selector = `input[id^="${prefix}_"]:checked`;
        return Array.from(container.querySelectorAll(selector)).map(cb => cb.value);
    },

    renderExperts(experts, recencyYear) {
    const container = this.el('expertsList');
    if (!container) return;

    if (!experts || experts.length === 0) {
        container.innerHTML = '<p>No experts match your filters.</p>';
        return;
    }

    container.innerHTML = experts.map(expert => {

        const expertId = expert.id; // ← assumes id is "san0028"
        const effective = Logic.calculateCitationsSince(expert, recencyYear);
        const label = recencyYear <= 1999
            ? "Total Cited"
            : `Citations Since ${recencyYear}`;

        const imgPath = `images/headshots/${expertId}.jpg`;

        return `
        <div class="card expert-card"
             onclick="window.location.href='papers.html?auid=${expertId}'">

            <div class="expert-img-wrapper">
                <img
                    src="${imgPath}"
                    alt="${expert.name}"
                    class="expert-headshot"
                    loading="lazy"
                    onerror="this.onerror=null; this.src='images/headshots/default.jpg';">
            </div>

            <h3>${expert.name}</h3>
            <p><strong>Title:</strong> ${expert.title || ''}</p>
            <p><strong>College:</strong> ${expert.college || ''}</p>
            <p style="font-size:0.8em; color:#666;">
                ${expert.degree || ''}
            </p>

            <div class="stats">
                <span style="font-weight:bold; color:#2980b9;">
                    ${label}: ${effective}
                </span>
            </div>

            <button class="view-papers-btn">
                View Papers
            </button>

        </div>`;
    }).join('');
},

    renderPapers(papers, recencyYear) {
        const container = this.el('papersList');
        if (!container) return;

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

    renderCheckboxes(items, containerId, namePrefix) {
        const container = this.el(containerId);
        if (!container) return;

        // Use event delegation in the controller instead of binding directly here
        container.innerHTML = items.map(item => `
            <div class="checkbox-visual">
                <input type="checkbox" value="${item}" id="${namePrefix}_${item.replace(/[^a-zA-Z0-9]/g, '')}" class="filter-cb">
                <label for="${namePrefix}_${item.replace(/[^a-zA-Z0-9]/g, '')}">${item}</label>
            </div>
        `).join('');
    },

    renderNestedCheckboxes(items, containerId, parentPrefix, childPrefix) {
        const container = this.el(containerId);
        if (!container) return;

        container.innerHTML = items.map(item => `
            <div class="checkbox-visual" style="flex-direction: column; align-items: flex-start; gap: 4px;">
                <div style="display:flex; align-items:center; gap:8px; width: 100%;">
                    <input type="checkbox" value="${item.name}" id="${parentPrefix}_${item.name.replace(/[^a-zA-Z0-9]/g, '')}" class="filter-cb parent-cb">
                    <label for="${parentPrefix}_${item.name.replace(/[^a-zA-Z0-9]/g, '')}"><strong>${item.name}</strong></label>
                </div>
                <div class="nested-checkboxes" style="margin-left: 24px; display: none; width: 100%; margin-top: 4px;">
                    ${item.children.map(child => `
                        <div class="checkbox-visual" style="margin-bottom: 4px;">
                            <input type="checkbox" value="${child}" id="${childPrefix}_${child.replace(/[^a-zA-Z0-9]/g, '')}" class="filter-cb">
                            <label for="${childPrefix}_${child.replace(/[^a-zA-Z0-9]/g, '')}">${child}</label>
                        </div>
                    `).join('')}
                </div>
            </div>
        `).join('');
    }
};
