/**
 * Shared helper functions (used by opportunity.js and experts.js).
 * B3 uses fetchJSON for loading expert data.
 */

/**
 * Fetches a URL and parses the response as JSON.
 * @param {string} url - Path to JSON file (e.g. "data/experts.json")
 * @returns {Promise<unknown>} Parsed JSON
 */
function fetchJSON(url) {
  return fetch(url).then(function (res) {
    if (!res.ok) throw new Error("Failed to load: " + url);
    return res.json();
  });
}

window.fetchJSON = fetchJSON;
