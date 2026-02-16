const mysql = require("mysql2/promise");
require("dotenv").config({ path: ".env" });

async function check() {
    const conn = await mysql.createConnection({
        host: process.env.MYSQL_HOST,
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE,
    });

    const [rows] = await conn.query("SELECT paper_id, citation_per_year FROM papers WHERE citation_per_year IS NOT NULL AND JSON_LENGTH(citation_per_year) > 0 LIMIT 2");
    console.log(JSON.stringify(rows, null, 2));
    await conn.end();
}
check().catch(console.error);
