/**
 * B3: JavaScript logic for Expert Page.
 * - Loads expert JSON data
 * - Search by name, sort by metrics, render list and profile
 */

(function () {
  "use strict";

  var experts = [];
  var expertDetails = {}; // id -> { name, expertise, keywords, publications }
  var sortBy = "name"; // "name" | "publications" | "keywords"
  var searchQuery = "";

  var listEl = document.getElementById("expert-list");
  var detailEl = document.getElementById("expert-detail");
  var searchInput = document.getElementById("expert-search");
  var sortSelect = document.getElementById("expert-sort");

  function loadData() {
    Promise.all([
      window.fetchJSON("data/experts.json"),
      window.fetchJSON("data/expert_details.json"),
    ])
      .then(function (results) {
        experts = Array.isArray(results[0]) ? results[0] : [];
        expertDetails = results[1] && typeof results[1] === "object" ? results[1] : {};
        render();
      })
      .catch(function (err) {
        console.error("Expert data load error:", err);
        if (listEl) listEl.textContent = "Failed to load experts. Check console.";
      });
  }

  function filteredAndSortedExperts() {
    var list = experts.slice();
    if (searchQuery) {
      var q = searchQuery.toLowerCase();
      list = list.filter(function (e) {
        return (e.name || "").toLowerCase().indexOf(q) !== -1;
      });
    }
    list.sort(function (a, b) {
      if (sortBy === "name") {
        return (a.name || "").localeCompare(b.name || "");
      }
      if (sortBy === "publications") {
        return (b.publicationCount || 0) - (a.publicationCount || 0);
      }
      if (sortBy === "keywords") {
        return (b.keywordCount || 0) - (a.keywordCount || 0);
      }
      return 0;
    });
    return list;
  }

  function renderList() {
    if (!listEl) return;
    var list = filteredAndSortedExperts();
    listEl.innerHTML = "";
    list.forEach(function (expert) {
      var item = document.createElement("div");
      item.className = "expert-list-item";
      item.setAttribute("data-expert-id", expert.id || "");
      item.textContent = expert.name || "Unnamed";
      var meta = document.createElement("span");
      meta.className = "expert-list-meta";
      meta.textContent = "Publications: " + (expert.publicationCount || 0) + ", Keywords: " + (expert.keywordCount || 0);
      item.appendChild(meta);
      item.addEventListener("click", function () {
        showExpertProfile(expert);
      });
      listEl.appendChild(item);
    });
  }

  function showExpertProfile(expert) {
    if (!detailEl) return;
    var data = expertDetails[expert.id] || expert;
    var name = data.name || expert.name || "Unknown";
    detailEl.innerHTML = "";

    var nameEl = document.createElement("h3");
    nameEl.textContent = name;
    detailEl.appendChild(nameEl);

    if (data.expertise && data.expertise.length) {
      var expEl = document.createElement("p");
      expEl.className = "expert-detail-section";
      expEl.innerHTML = "<strong>Expertise</strong>: " + data.expertise.slice(0, 20).join(", ") + (data.expertise.length > 20 ? " …" : "");
      detailEl.appendChild(expEl);
    }
    if (data.keywords && data.keywords.length) {
      var kwEl = document.createElement("p");
      kwEl.className = "expert-detail-section";
      kwEl.innerHTML = "<strong>Keywords</strong>: " + data.keywords.slice(0, 25).join(", ") + (data.keywords.length > 25 ? " …" : "");
      detailEl.appendChild(kwEl);
    }

    if (data.publications && data.publications.length) {
      var pubHead = document.createElement("h4");
      pubHead.textContent = "Publications (" + data.publications.length + ")";
      detailEl.appendChild(pubHead);
      var pubList = document.createElement("ul");
      pubList.className = "expert-publications";
      data.publications.slice(0, 50).forEach(function (p) {
        var li = document.createElement("li");
        var title = p.title || "Untitled";
        if (p.link) {
          var a = document.createElement("a");
          a.href = p.link;
          a.target = "_blank";
          a.rel = "noopener";
          a.textContent = title;
          li.appendChild(a);
        } else {
          li.textContent = title;
        }
        var meta = [];
        if (p.publication_date) meta.push(p.publication_date);
        if (p.published_in) meta.push(p.published_in);
        if (p.total_citations != null) meta.push(p.total_citations + " citations");
        if (meta.length) {
          var span = document.createElement("span");
          span.className = "expert-pub-meta";
          span.textContent = " — " + meta.join(" · ");
          li.appendChild(span);
        }
        pubList.appendChild(li);
      });
      detailEl.appendChild(pubList);
      if (data.publications.length > 50) {
        var more = document.createElement("p");
        more.className = "expert-pub-more";
        more.textContent = "… and " + (data.publications.length - 50) + " more.";
        detailEl.appendChild(more);
      }
    } else if (!detailEl.querySelector("p") && !detailEl.querySelector("ul")) {
      var fallback = document.createElement("p");
      fallback.textContent = "Publications: " + (expert.publicationCount || 0) + ", Keywords: " + (expert.keywordCount || 0);
      detailEl.appendChild(fallback);
    }
  }

  function render() {
    renderList();
    if (detailEl && !detailEl.innerHTML && experts.length > 0) {
      showExpertProfile(experts[0]);
    }
  }

  function onSearch() {
    searchQuery = (searchInput && searchInput.value) ? searchInput.value.trim() : "";
    render();
  }

  function onSort() {
    sortBy = (sortSelect && sortSelect.value) ? sortSelect.value : "name";
    render();
  }

  function init() {
    if (searchInput) searchInput.addEventListener("input", onSearch);
    if (sortSelect) sortSelect.addEventListener("change", onSort);
    loadData();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
