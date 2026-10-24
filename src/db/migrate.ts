import { promises as fs } from "fs";
import path from "path";
import { FileMigrationProvider, Migrator } from "kysely";
import { createDb } from "./client";
import { loadConfig } from "../config";

// Runs pending migrations. Use ts-node: tsc doesn't copy .sql files.
export async function migrate(databaseUrl: string): Promise<string[]> {
	const db = createDb(databaseUrl);
	try {
		const migrator = new Migrator({
			db,
			provider: new FileMigrationProvider({ fs, path, migrationFolder: path.join(__dirname, "migrations") }),
		});
		const { error, results = [] } = await migrator.migrateToLatest();
		if (error) throw error;
		return results.map((result) => result.migrationName);
	} finally {
		await db.destroy();
	}
}

if (require.main === module) {
	migrate(loadConfig().DATABASE_URL)
		.then((applied) => console.log(applied.length ? `Applied: ${applied.join(", ")}` : "No pending migrations"))
		.catch((error) => {
			console.error("Migration failed:", error instanceof Error ? error.message : error);
			process.exit(1);
		});
}
