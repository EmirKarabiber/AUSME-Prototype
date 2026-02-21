/**
 * B3: Export experts from MySQL (main_ausme) to data/experts.json and data/expert_details.json.
 *
 * Uses tables: users_researcher, users_employee, researcher_expertise,
 *              papers_researchers, papers (and paper_keywords if present).
 *
 * Usage:
 *   npm install
 *   # Create .env in project root with MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE
 *   npm run export:experts:inspect   # Show schema
 *   npm run export:experts           # Write JSON
 */

const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "..");

// Load .env from project root
require("dotenv").config({ path: path.join(PROJECT_ROOT, ".env") });

const mysql = require("mysql2/promise");

function env(key, fallback) {
  let v = process.env[key];
  if (v == null || v === "") return fallback;
  v = String(v).trim();
  if (v.startsWith("=")) v = v.slice(1).trim();
  return v || fallback;
}

function getConfig() {
  return {
    host: env("MYSQL_HOST", "localhost"),
    user: env("MYSQL_USER", "emir"),
    password: env("MYSQL_PASSWORD", ""),
    database: env("MYSQL_DATABASE", "main_ausme"),
  };
}

async function connect() {
  const c = getConfig();
  if (!c.password) {
    console.error("Set MYSQL_PASSWORD in .env or environment.");
    process.exit(1);
  }
  return mysql.createConnection({
    host: c.host,
    user: c.user,
    password: c.password,
    database: c.database,
  });
}

// -----------------------------------------------------------------------------
// Schema inspection
// -----------------------------------------------------------------------------
const TABLE_NAMES = [
  "users_researcher",
  "users_employee",
  "researcher_expertise",
  "papers_researchers",
  "faculty_papers",
  "users_college",
  "users_department",
  "users_degree",
  "papers",
  "paper_keywords",
  "users_similarprofile",
];

function typoName(name) {
  return name
    .replace("researcher", "resercher")
    .replace("employee", "empoyee")
    .replace("researchers", "reserchers");
}

async function inspect(conn) {
  const [rows] = await conn.query("SHOW TABLES");
  const tables = new Set(rows.map((r) => Object.values(r)[0]));
  console.log("All tables in database:");
  [...tables].sort().forEach((t) => console.log("  ", t));
  console.log();

  for (const name of TABLE_NAMES) {
    let tableName = name;
    if (!tables.has(tableName)) tableName = typoName(name);
    if (!tables.has(tableName)) {
      console.log("  (table " + name + " not found)\n");
      continue;
    }
    console.log("DESCRIBE " + tableName + ":");
    const [desc] = await conn.query("DESCRIBE ??", [tableName]);
    desc.forEach((row) => console.log("  ", row));
    console.log();
  }
}

// -----------------------------------------------------------------------------
// Export: SQL matches main_ausme schema (users_researcher.employee_id = users_employee.auid)
// -----------------------------------------------------------------------------
// -----------------------------------------------------------------------------
// Export: SQL matches actual ausme_db schema
// -----------------------------------------------------------------------------
// -----------------------------------------------------------------------------
// Export: SQL matches actual ausme_db schema
// -----------------------------------------------------------------------------
const SQL_LIST_FULL = `
  SELECT
    r.employee_id AS id,
    COALESCE(CONCAT(e.first_name, ' ', e.last_name), e.email, r.employee_id) AS name,
    e.title,
    c.name AS college,
    d.name AS department,
    '' AS degree,
    (SELECT COUNT(*) FROM papers_researchers pr WHERE pr.researcher_id = r.employee_id) AS publicationCount,
    (SELECT COUNT(DISTINCT pk.keyword)
     FROM papers_researchers pr
     JOIN paper_keywords pk ON pk.paper_id = pr.paper_id
     WHERE pr.researcher_id = r.employee_id) AS keywordCount
  FROM users_researcher r
  JOIN users_employee e ON e.auid = r.employee_id
  LEFT JOIN users_college c ON c.id = e.college_id
  LEFT JOIN users_department d ON d.id = e.department_id
  ORDER BY e.last_name, e.first_name
`;

async function exportExpertsList(conn) {
  let rows;
  try {
    [rows] = await conn.query(SQL_LIST_FULL);
  } catch (e) {
    console.error("List query failed.");
    console.error(e.message);
    return [];
  }
  return rows.map((r) => ({
    id: String(r.id),
    name: r.name || "Unnamed",
    title: r.title || "",
    college: r.college || "",
    department: r.department || "",
    degree: r.degree || "",
    publicationCount: Number(r.publicationCount || 0),
    keywordCount: Number(r.keywordCount || 0),
    // Will be populated with aggregations later
    totalCitations: 0,
    citationsPerYear: {}
  }));
}

/** Build expert_details.json: one object keyed by expert id with name, expertise, keywords, publications (from SQL). */
async function exportAllExpertsDetails(conn, experts) {
  const nameById = {};
  experts.forEach((e) => {
    nameById[e.id] = e.name || "Unnamed";
  });

  const detailsById = {};
  experts.forEach((e) => {
    detailsById[e.id] = {
      name: nameById[e.id],
      title: e.title,
      college: e.college,
      department: e.department,
      degree: e.degree,
      expertise: [],
      keywords: [],
      publications: []
    };
  });

  // Expertise
  const [expRows] = await conn.query(
    "SELECT researcher_id, topic FROM researcher_expertise"
  );
  expRows.forEach((r) => {
    const id = String(r.researcher_id);
    if (detailsById[id]) detailsById[id].expertise.push(r.topic);
  });

  // Keywords (via papers)
  const [kwRows] = await conn.query(`
    SELECT pr.researcher_id, pk.keyword
    FROM papers_researchers pr
    JOIN paper_keywords pk ON pk.paper_id = pr.paper_id
  `);
  const seenKw = {};
  kwRows.forEach((r) => {
    const id = String(r.researcher_id);
    const key = id + "\t" + (r.keyword || "");
    if (seenKw[key]) return;
    seenKw[key] = true;
    if (detailsById[id]) detailsById[id].keywords.push(r.keyword);
  });

  // Publications
  const [pubRows] = await conn.query(`
    SELECT pr.researcher_id,
           p.title, p.publication_date, p.link, p.authors_display, p.published_in, p.total_citations, p.citation_per_year
    FROM papers_researchers pr
    JOIN papers p ON p.id = pr.paper_id
    ORDER BY pr.researcher_id, p.publication_date DESC
  `);

  pubRows.forEach((r) => {
    const id = String(r.researcher_id);
    if (!detailsById[id]) return;

    // Parse citation_per_year if string, or use as object
    let cpy = [];
    if (r.citation_per_year) {
      try {
        cpy = typeof r.citation_per_year === 'string' ? JSON.parse(r.citation_per_year) : r.citation_per_year;
      } catch (e) { cpy = []; }
    }

    // Add to details
    detailsById[id].publications.push({
      title: r.title || "",
      publication_date: (r.publication_date instanceof Date) ? r.publication_date.toISOString().slice(0, 10) : (r.publication_date ? String(r.publication_date).slice(0, 10) : null),
      link: r.link || null,
      authors_display: r.authors_display || null,
      published_in: r.published_in || null,
      total_citations: r.total_citations != null ? Number(r.total_citations) : 0,
      citation_per_year: cpy
    });

    // Aggregate for the expert list (experts.json)
    const expertListItem = experts.find(e => e.id === id);
    if (expertListItem) {
      expertListItem.totalCitations += (r.total_citations != null ? Number(r.total_citations) : 0);

      // Sum up yearly breakdown
      if (Array.isArray(cpy)) {
        cpy.forEach(yearEntry => {
          const y = String(yearEntry.year);
          const c = Number(yearEntry.citations || 0);
          if (!expertListItem.citationsPerYear[y]) expertListItem.citationsPerYear[y] = 0;
          expertListItem.citationsPerYear[y] += c;
        });
      }
    }
  });

  return detailsById;
}

/** Build expert_similar_profiles.json from users_similarprofile: { "auid": ["similar_auid1", ...], ... }. */
async function exportSimilarProfiles(conn) {
  const byAuid = {};
  const tableNames = ["users_similarprofile", "users_similarprofiles"];

  for (const tableName of tableNames) {
    try {
      const [rows] = await conn.query("SELECT * FROM ?? LIMIT 1", [tableName]);
      if (!rows || rows.length === 0) continue;
      const cols = Object.keys(rows[0]);
      const idCol = cols.find((c) => /researcher_id|user_id|auid|faculty_id|source/.test(c)) || cols[0];
      // Column that holds the *similar researcher's id* (never the score)
      const scoreLike = (c) => /^score$/i.test(c) || /similarity|similarity_score/.test(c);
      const candidateCols = cols.filter((c) => c !== idCol && !scoreLike(c));
      const similarCol =
        candidateCols.find((c) => /similar|target|match|other|_id|auid/.test(c)) ||
        candidateCols[0] ||
        cols[1];
      const [allRows] = await conn.query("SELECT ??, ?? FROM ??", [idCol, similarCol, tableName]);

      allRows.forEach((r) => {
        const id = String(r[idCol] || "").trim();
        const similar = String(r[similarCol] || "").trim();
        if (!id || !similar || id === similar) return;
        // Skip if "similar" looks like a score (numeric 0–1) not an employee code
        if (/^\d*\.?\d+$/.test(similar) && similar.length <= 5) return;
        if (!byAuid[id]) byAuid[id] = [];
        if (!byAuid[id].includes(similar)) byAuid[id].push(similar);
      });
      break;
    } catch (e) {
      continue;
    }
  }
  return byAuid;
}

async function runExport(conn) {
  const dataDir = path.join(PROJECT_ROOT, "data");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const experts = await exportExpertsList(conn);
  // Note: experts array is mutated in exportAllExpertsDetails to add citationsPerYear
  const allDetails = await exportAllExpertsDetails(conn, experts);

  fs.writeFileSync(
    path.join(dataDir, "experts.json"),
    JSON.stringify(experts, null, 2),
    "utf8"
  );
  console.log("Wrote data/experts.json (" + experts.length + " experts)");

  fs.writeFileSync(
    path.join(dataDir, "expert_details.json"),
    JSON.stringify(allDetails, null, 2),
    "utf8"
  );
  console.log("Wrote data/expert_details.json (detail view for all experts, with publications)");

  const similarProfiles = await exportSimilarProfiles(conn);
  fs.writeFileSync(
    path.join(dataDir, "expert_similar_profiles.json"),
    JSON.stringify(similarProfiles, null, 2),
    "utf8"
  );
  const similarCount = Object.keys(similarProfiles).length;
  console.log("Wrote data/expert_similar_profiles.json (" + similarCount + " experts with similar profiles)");
}

async function main() {
  const inspectFlag = process.argv.includes("--inspect");
  const exportFlag = process.argv.includes("--export");

  if (!inspectFlag && !exportFlag) {
    console.log("Usage: node experts_export.js [--inspect] [--export]");
    console.log("  --inspect   Print DB schema for expert-related tables");
    console.log("  --export    Write data/experts.json and data/expert_details.json");
    process.exit(0);
  }

  const conn = await connect();
  try {
    if (inspectFlag) await inspect(conn);
    if (exportFlag) await runExport(conn);
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
