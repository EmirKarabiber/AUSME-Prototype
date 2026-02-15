# Scripts: MySQL → JSON for Experts (B3)

## Purpose

**B3:** Get expert data from MySQL (`main_ausme`) and produce the JSON consumed by `experts.js` (`data/experts.json`, `data/expert_details.json`).

## Setup

1. **Install dependencies (once):**
   ```bash
   npm install
   ```

2. **Configure DB (do not commit real password):**
   - Copy `.env.example` to `.env` in the project root: `cp .env.example .env`
   - Edit `.env` and set `MYSQL_PASSWORD` (and adjust host/user/database if needed).

## Commands (from project root)

```bash
# Inspect schema (table and column names)
npm run export:experts:inspect

# Export experts to JSON
npm run export:experts
```

Or run the script directly:

```bash
node scripts/experts_export.js --inspect
node scripts/experts_export.js --export
```

## Output

- **data/experts.json** – list: `id`, `name`, `publicationCount`, `keywordCount`
- **data/expert_details.json** – all experts’ detail: `name`, `expertise[]`, `keywords[]`, `publications[]`

To view the app: run `npm start` and open **http://localhost:3000/experts.html**.

## Tables used

| Table                 | Role |
|-----------------------|------|
| `users_researcher`   | Expert list: employee_id, joined to users_employee for name |
| `users_employee`      | first_name, last_name (auid = users_researcher.employee_id) |
| `researcher_expertise`| topic per researcher |
| `papers_researchers`  | Publication count per researcher |
| `papers`              | Paper records |
| `paper_keywords`      | keyword, paper_id → keyword count |

If your schema differs, run `--inspect` and edit the SQL in `scripts/experts_export.js`.
