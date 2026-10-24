import { readFileSync } from "fs";
import path from "path";
import { Kysely, sql } from "kysely";

// Kysely ignores .sql files, so the SQL only runs from here.
const upSql = readFileSync(path.join(__dirname, "001_init.sql"), "utf8");

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql.raw(upSql).execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql.raw("DROP TABLE jobs; DROP TABLE forms; DROP TABLE postcodes; DROP TABLE submissions;").execute(db);
}
