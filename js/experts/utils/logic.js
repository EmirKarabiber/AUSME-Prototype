// js/utils/logic.js

export const Logic = {
    CURRENT_YEAR: 2026,
    ALL_TIME_YEAR: 1999,

    calculateCitationsSince(obj, startYear) {
        if (startYear <= this.ALL_TIME_YEAR) {
            return (obj.totalCitations || obj.total_citations || 0);
        }

        let total = 0;
        const cpy = obj.citationsPerYear || obj.citation_per_year;

        if (!cpy) return 0;

        if (Array.isArray(cpy)) {
            cpy.forEach(entry => {
                if (entry.year >= startYear) {
                    total += (entry.citations || 0);
                }
            });
        } else if (typeof cpy === 'object') {
            Object.keys(cpy).forEach(year => {
                if (parseInt(year) >= startYear) {
                    total += (cpy[year] || 0);
                }
            });
        }

        return total;
    },

    filterExperts(experts, criteria) {
        return experts.filter(expert => {
            const nameText = `${expert.name || ''}`.toLowerCase();
            const matchesSearch = !criteria.search || nameText.includes(criteria.search);
            const matchesCollege = !criteria.colleges?.length || criteria.colleges.includes(expert.college);
            const matchesDegree = !criteria.degrees?.length || criteria.degrees.includes(expert.degree);
            const matchesDepartment = !criteria.departments?.length || criteria.departments.includes(expert.department);

            const effectiveCitations = this.calculateCitationsSince(expert, criteria.recencyYear);
            const matchesCitations = effectiveCitations >= criteria.minCitations;

            return matchesSearch && matchesCollege && matchesDegree && matchesDepartment && matchesCitations;
        });
    },

    filterPapers(papers, criteria) {
        return papers.filter(p => {
            const pubYear = p.publication_date ? parseInt(p.publication_date.substring(0, 4)) : 0;
            const textMatch = (p.title || '').toLowerCase().includes(criteria.search);
            const yearMatch = pubYear >= criteria.startYear && pubYear <= criteria.endYear;

            const effectiveCitations = this.calculateCitationsSince(p, criteria.recencyYear);
            const matchesCitations = effectiveCitations >= criteria.minCitations;

            return textMatch && yearMatch && matchesCitations;
        });
    },

    sortData(data, sortType, recencyYear = 1999) {
        return [...data].sort((a, b) => {
            switch (sortType) {
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
                default:
                    return (a.name || a.title).localeCompare(b.name || b.title);
            }
        });
    }
};
