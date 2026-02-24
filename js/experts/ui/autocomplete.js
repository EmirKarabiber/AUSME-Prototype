// js/ui/autocomplete.js

export class AutocompleteManager {
    constructor(searchInputId, ghostId, suggestionsContainerId, getDataCallback, onSelectCallback) {
        this.searchInput = document.getElementById(searchInputId);
        this.searchGhost = document.getElementById(ghostId);
        this.suggestionsContainer = document.getElementById(suggestionsContainerId);
        this.getData = getDataCallback; // Function returning array of all expert names
        this.onSelect = onSelectCallback; // Function to trigger filter refresh
        this.currentFocus = -1;

        this.initListeners();
    }

    initListeners() {
        if (!this.searchInput) return;

        this.searchInput.addEventListener('input', (e) => {
            this.onSelect(); // Trigger immediate filter refresh
            this.handleInput(e.target.value);
        });

        this.searchInput.addEventListener('keydown', (e) => this.handleKeydown(e));

        this.searchInput.addEventListener('blur', () => {
            if (this.searchGhost) this.searchGhost.style.display = 'none';
        });

        this.searchInput.addEventListener('focus', () => {
            if (this.searchGhost) this.searchGhost.style.display = 'block';
            if (this.searchInput.value) {
                this.handleInput(this.searchInput.value);
            }
        });

        document.addEventListener('click', (e) => {
            if (this.suggestionsContainer && e.target !== this.searchInput && e.target !== this.suggestionsContainer) {
                this.suggestionsContainer.style.display = 'none';
            }
        });
    }

    handleInput(val) {
        if (!this.suggestionsContainer) return;

        this.suggestionsContainer.innerHTML = '';
        this.currentFocus = -1;
        const valLower = val.toLowerCase();

        if (!val) {
            this.suggestionsContainer.style.display = 'none';
            if (this.searchGhost) this.searchGhost.value = '';
            return;
        }

        const allNames = this.getData();
        const matches = [...new Set(allNames)]
            .filter(name => name.toLowerCase().includes(valLower))
            .sort((a, b) => {
                const aLower = a.toLowerCase();
                const bLower = b.toLowerCase();

                if (aLower === valLower) return -1;
                if (bLower === valLower) return 1;

                const aStarts = aLower.startsWith(valLower) ? 0 : 1;
                const bStarts = bLower.startsWith(valLower) ? 0 : 1;
                if (aStarts !== bStarts) return aStarts - bStarts;

                const aIndex = aLower.indexOf(valLower);
                const bIndex = bLower.indexOf(valLower);
                if (aIndex !== bIndex) return aIndex - bIndex;

                return aLower.localeCompare(bLower);
            })
            .slice(0, 10);

        // Handle Ghost Text
        if (this.searchGhost) {
            if (matches.length > 0 && matches[0].toLowerCase().startsWith(valLower)) {
                this.searchGhost.value = val + matches[0].substring(val.length);
            } else {
                this.searchGhost.value = '';
            }
        }

        // Render suggestions
        if (matches.length > 0) {
            this.suggestionsContainer.style.display = 'block';
            matches.forEach((match) => {
                const div = document.createElement('div');
                div.className = 'suggestion-item';
                div.innerHTML = match;
                div.addEventListener('click', () => {
                    this.searchInput.value = match;
                    if (this.searchGhost) this.searchGhost.value = '';
                    this.suggestionsContainer.style.display = 'none';
                    this.onSelect();
                });
                this.suggestionsContainer.appendChild(div);
            });
        } else {
            this.suggestionsContainer.style.display = 'none';
        }
    }

    handleKeydown(e) {
        if (!this.suggestionsContainer) return;
        let items = this.suggestionsContainer.getElementsByClassName('suggestion-item');

        // Right Arrow accept ghost
        if (e.key === 'ArrowRight' && this.searchGhost && this.searchGhost.value && this.searchGhost.value !== this.searchInput.value) {
            e.preventDefault();
            this.searchInput.value = this.searchGhost.value;
            this.handleInput(this.searchInput.value);
            this.onSelect();
            return;
        }

        if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
            if (e.key === 'Tab') e.preventDefault();
            this.currentFocus++;
            this.addActive(items);
        } else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
            if (e.key === 'Tab') e.preventDefault();
            this.currentFocus--;
            this.addActive(items);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (this.currentFocus > -1) {
                if (items && items[this.currentFocus]) items[this.currentFocus].click();
            } else if (items.length > 0) {
                items[0].click();
            }
            if (this.searchGhost) this.searchGhost.value = '';
        }
    }

    addActive(items) {
        if (!items) return false;
        this.removeActive(items);
        if (this.currentFocus >= items.length) this.currentFocus = 0;
        if (this.currentFocus < 0) this.currentFocus = (items.length - 1);
        items[this.currentFocus].classList.add('autocomplete-active');
    }

    removeActive(items) {
        for (let i = 0; i < items.length; i++) {
            items[i].classList.remove('autocomplete-active');
        }
    }
}
