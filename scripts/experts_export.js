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
  "papers",
  "paper_keywords",
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
const SQL_LIST_FULL = `
  SELECT
    r.employee_id AS id,
    COALESCE(CONCAT(e.first_name, ' ', e.last_name), e.email, r.employee_id) AS name,
    (SELECT COUNT(*) FROM papers_researchers pr WHERE pr.researcher_id = r.employee_id) AS publicationCount,
    (SELECT COUNT(DISTINCT pk.keyword)
     FROM papers_researchers pr
     JOIN paper_keywords pk ON pk.paper_id = pr.paper_id
     WHERE pr.researcher_id = r.employee_id) AS keywordCount
  FROM users_researcher r
  JOIN users_employee e ON e.auid = r.employee_id
  ORDER BY e.last_name, e.first_name
`;

const SQL_LIST_FALLBACK = `
  SELECT
    r.employee_id AS id,
    COALESCE(CONCAT(e.first_name, ' ', e.last_name), e.email, r.employee_id) AS name,
    (SELECT COUNT(*) FROM papers_researchers pr WHERE pr.researcher_id = r.employee_id) AS publicationCount,
    0 AS keywordCount
  FROM users_researcher r
  JOIN users_employee e ON e.auid = r.employee_id
  ORDER BY e.last_name, e.first_name
`;

async function exportExpertsList(conn) {
  let rows;
  try {
    [rows] = await conn.query(SQL_LIST_FULL);
  } catch (e) {
    try {
      [rows] = await conn.query(SQL_LIST_FALLBACK);
    } catch (e2) {
      console.error("List query failed. Run --inspect and adjust SQL in scripts/experts_export.js.");
      console.error(e2.message);
      return [];
    }
  }
  return rows.map((r) => ({
    id: String(r.id),
    name: r.name || "Unnamed",
    publicationCount: Number(r.publicationCount || 0),
    keywordCount: Number(r.keywordCount || 0),
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
    detailsById[e.id] = { name: nameById[e.id], expertise: [], keywords: [], publications: [] };
  });

  const [expRows] = await conn.query(
    "SELECT researcher_id, topic FROM researcher_expertise"
  );
  expRows.forEach((r) => {
    const id = String(r.researcher_id);
    if (detailsById[id]) detailsById[id].expertise.push(r.topic);
  });

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

  const [pubRows] = await conn.query(`
    SELECT pr.researcher_id,
           p.title, p.publication_date, p.link, p.authors_display, p.published_in, p.total_citations
    FROM papers_researchers pr
    JOIN papers p ON p.id = pr.paper_id
    ORDER BY pr.researcher_id, p.publication_date DESC
  `);
  pubRows.forEach((r) => {
    const id = String(r.researcher_id);
    if (!detailsById[id]) return;
    detailsById[id].publications.push({
      title: r.title || "",
      publication_date: r.publication_date ? String(r.publication_date).slice(0, 10) : null,
      link: r.link || null,
      authors_display: r.authors_display || null,
      published_in: r.published_in || null,
      total_citations: r.total_citations != null ? Number(r.total_citations) : null,
    });
  });

  return detailsById;
}

async function runExport(conn) {
  const dataDir = path.join(PROJECT_ROOT, "data");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const experts = await exportExpertsList(conn);
  fs.writeFileSync(
    path.join(dataDir, "experts.json"),
    JSON.stringify(experts, null, 2),
    "utf8"
  );
  console.log("Wrote data/experts.json (" + experts.length + " experts)");

  const allDetails = await exportAllExpertsDetails(conn, experts);
  fs.writeFileSync(
    path.join(dataDir, "expert_details.json"),
    JSON.stringify(allDetails, null, 2),
    "utf8"
  );
  console.log("Wrote data/expert_details.json (detail view for all experts, with publications)");
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
