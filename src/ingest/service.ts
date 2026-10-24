import type { Kysely, Transaction } from "kysely";
import { Database, FormStatus } from "../db/types";
import { extractApplicationReference, hashPayload } from "./dedupe";

export interface IngestResult {
	submissionId: string;
	duplicate: boolean;
	missingReference: boolean;
}

export interface IngestService {
	ingest(payload: Record<string, unknown>): Promise<IngestResult>;
}

type Trx = Transaction<Database>;

export function createIngestService({
	db,
	retryWindowMs,
}: {
	db: Kysely<Database>;
	retryWindowMs: number;
}): IngestService {
	return {
		ingest: (payload) =>
			db
				.transaction()
				.execute(async (trx) => {
					const payloadHash = hashPayload(payload);
					const applicationReference = extractApplicationReference(payload);
					const missingReference = applicationReference === null;

					const inserted = await trx
						.insertInto("submissions")
						.values({
							application_reference: applicationReference,
							payload_hash: payloadHash,
							payload: JSON.stringify(payload),
						})
						.onConflict((oc) => oc
							.column("payload_hash")
							.doNothing())
						.returning("id")
						.executeTakeFirst();

					if (inserted) {
						if (applicationReference === null) {
							// No identity to dedupe on, so it can never be delivered safely.
							await createUnreferencedForm(trx, inserted.id);
						} else {
							const form = await createPendingForm(trx, applicationReference, inserted.id);
							if (form) {
								await trx
									.insertInto("jobs")
									.values({
										submission_id: inserted.id,
										form_id: form.id,
										type: "transform",
										deadline_at: new Date(Date.now() + retryWindowMs),
									})
									.execute();
							} else {
								// Kept as a submission for review; never transformed.
								await flagConflictingVersion(trx, applicationReference);
							}
						}
						return { submissionId: inserted.id, duplicate: false, missingReference };
					}

					const existing = await trx
						.updateTable("submissions")
						.set((eb) => ({
							duplicate_count: eb("duplicate_count", "+", 1),
							last_seen_at: new Date(),
						}))
						.where("payload_hash", "=", payloadHash)
						.returning("id")
						.executeTakeFirstOrThrow();
					return { submissionId: existing.id, duplicate: true, missingReference };
				}),
	};
}

async function createUnreferencedForm(trx: Trx, submissionId: string): Promise<void> {
	await trx
		.insertInto("forms")
		.values({
			application_reference: null,
			submission_id: submissionId,
			status: FormStatus.NeedsReview,
			status_reason: "missing application_reference",
		})
		.execute();
}

// The unique reference decides the winner: a concurrent ingest for the same
// reference blocks here until the first commits, then gets nothing back.
async function createPendingForm(trx: Trx, applicationReference: string, submissionId: string) {
	return trx
		.insertInto("forms")
		.values({
			application_reference: applicationReference,
			submission_id: submissionId,
			status: FormStatus.Pending,
		})
		.onConflict((oc) => oc
			.column("application_reference")
			.doNothing())
		.returning("id")
		.executeTakeFirst();
}

// Another version of an existing application: flag it, review if not delivered.
async function flagConflictingVersion(trx: Trx, applicationReference: string): Promise<void> {
	await trx
		.updateTable("forms")
		.set((eb) => ({
			has_conflicting_versions: true,
			status: eb
				.case()
				.when("formbot_delivered_at", "is", null)
				.then(FormStatus.NeedsReview)
				.else(eb.ref("status"))
				.end(),
			status_reason: eb
				.case()
				.when("formbot_delivered_at", "is", null)
				.then("conflicting submission version")
				.else(eb.ref("status_reason"))
				.end(),
			updated_at: new Date(),
		}))
		.where("application_reference", "=", applicationReference)
		.execute();
}
