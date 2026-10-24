import type { Kysely, Selectable, Transaction } from "kysely";
import type { Logger } from "pino";
import { Database, FormStatus, JobsTable, JobStatus, JobType } from "../db/types";

export type Job = Selectable<JobsTable>;

export type JobResult = { outcome: "success" } | { outcome: "retry"; error: string };

// Handlers mark their job succeeded in the same transaction as their writes.
export type JobHandler = (job: Job, db: Kysely<Database>) => Promise<JobResult>;

// Succeeded jobs are never deleted.
export async function completeJob(trx: Transaction<Database>, jobId: string): Promise<void> {
	await trx
		.updateTable("jobs")
		.set({ status: JobStatus.Succeeded })
		.where("id", "=", jobId)
		.execute();
}

// At most one per form and type.
export async function enqueueFormJob(
	trx: Transaction<Database>,
	parentJob: Job,
	formId: string,
	type: Exclude<JobType, "transform">,
	retryWindowMs: number,
): Promise<void> {
	await trx
		.insertInto("jobs")
		.values({
			submission_id: parentJob.submission_id,
			form_id: formId,
			type,
			deadline_at: new Date(Date.now() + retryWindowMs),
		})
		.onConflict((oc) => oc
			.columns(["form_id", "type"])
			.doNothing())
		.execute();
}

export function createRunner({
	db,
	logger,
	handlers,
	pollIntervalMs,
	staleJobMs,
}: {
	db: Kysely<Database>;
	logger: Logger;
	handlers: Partial<Record<JobType, JobHandler>>;
	pollIntervalMs: number;
	staleJobMs: number;
}) {
	// Only claim job types that have a handler.
	const types = Object.keys(handlers) as JobType[];

	return { runOnce, start };

	// One job at a time; sleeps when idle.
	async function start(): Promise<void> {
		while (true) {
			let worked = false;
			try {
				worked = await runOnce();
			} catch (err) {
				logger.error({ err }, "runner iteration failed");
			}
			if (!worked) {
				await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
			}
		}
	}

	async function runOnce(): Promise<boolean> {
		if (types.length === 0) {
			return false;
		}
		const job = await claimJob();
		if (!job) {
			return false;
		}
		let result: JobResult;
		try {
			result = await (handlers[job.type] as JobHandler)(job, db);
		} catch (err) {
			result = {
				outcome: "retry",
				error: err instanceof Error ? err.message : String(err),
			};
		}
		// On success, the handler has already saved.
		if (result.outcome === "retry") {
			await retry(job, result.error);
		}
		return true;
	}

	async function retry(job: Job, error: string): Promise<void> {
		if (Date.now() >= job.deadline_at.getTime()) {
			await db
				.transaction()
				.execute(async (trx) => {
					await trx
						.updateTable("jobs")
						.set({
							status: JobStatus.Dead,
							last_error: error,
						})
						.where("id", "=", job.id)
						.execute();
					// A failed email doesn't fail the form. Delivered forms are never failed.
					if (job.type !== "send_email") {
						await trx
							.updateTable("forms")
							.set({
								status: FormStatus.Failed,
								status_reason: `${job.type}: ${error}`,
								updated_at: new Date(),
							})
							.where("id", "=", job.form_id)
							.where("formbot_delivered_at", "is", null)
							.execute();
					}
				});
			logger.error(
				{
					jobId: job.id,
					jobType: job.type,
					formId: job.form_id,
					error,
				},
				"job dead: retry window exhausted",
			);
			return;
		}
		// Retry on the next poll. Backoff could go here.
		await db
			.updateTable("jobs")
			.set({
				status: JobStatus.Pending,
				run_at: new Date(),
				last_error: error,
			})
			.where("id", "=", job.id)
			.execute();
	}

	// Workers never claim the same job. Also reclaims jobs from crashed workers.
	function claimJob() {
		return db
			.updateTable("jobs")
			.set((eb) => ({
				status: JobStatus.Running,
				locked_at: new Date(),
				attempts: eb("attempts", "+", 1),
			}))
			.where("id", "=", db
				.selectFrom("jobs")
				.select("id")
				.where("type", "in", types)
				.where((eb) => eb.or([
					eb.and([
						eb("status", "=", JobStatus.Pending),
						eb("run_at", "<=", new Date()),
					]),
					eb.and([
						eb("status", "=", JobStatus.Running),
						eb("locked_at", "<", new Date(Date.now() - staleJobMs)),
					]),
				]))
				.orderBy("run_at")
				.limit(1)
				.forUpdate()
				.skipLocked())
			.returningAll()
			.executeTakeFirst();
	}
}
