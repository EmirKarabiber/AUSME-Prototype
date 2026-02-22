// js/services/dataService.js

class DataService {
    constructor() {
        this.experts = [];
        this.expertDetails = {};
        this.similarProfiles = {};
    }

    async loadExperts() {
        try {
            const response = await fetch('data/experts.json');
            this.experts = await response.json();
        } catch (error) {
            console.error("Failed to load experts:", error);
        }
    }

    async loadExpertDetails() {
        try {
            const response = await fetch('data/expert_details.json');
            this.expertDetails = await response.json();
        } catch (error) {
            console.error("Failed to load expert details:", error);
        }
    }

    async loadSimilarProfiles() {
        try {
            const response = await fetch('data/expert_similar_profiles.json');
            this.similarProfiles = await response.json();
        } catch (error) {
            console.error("Failed to load similar profiles:", error);
        }
    }

    getExperts() {
        return this.experts;
    }

    getExpertByAuid(auid) {
        return this.expertDetails[auid];
    }

    getPapersByAuid(auid) {
        const details = this.expertDetails[auid];
        return details ? details.publications : [];
    }

    getSimilarProfileAuids(auid) {
        return this.similarProfiles[auid] || [];
    }
}

// Export a singleton instance
export const dataService = new DataService();
