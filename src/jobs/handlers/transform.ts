import type { NotNull, Transaction, Updateable } from "kysely";
import type { Logger } from "pino";
import { Database, FormsTable, FormStatus } from "../../db/types";
import { transform } from "../../forms/transform";
import type { TransformedForm } from "../../forms/validationSchemas";
import { completeJob, enqueueFormJob, JobHandler } from "../runner";

type Trx = Transaction<Database>;

export function createTransformHandler({
	logger,
	retryWindowMs,
}: {
	logger: Logger;
	retryWindowMs: number;
}): JobHandler {
	return (job, db) => db
		.transaction()
		.execute(async (trx) => {
			const form = await lockForm(trx, job.form_id);
			const log = logger.child({
				jobId: job.id,
				formId: form.id,
			});

			// Already transformed by an earlier run, or flagged for review since ingest.
			if (form.status !== FormStatus.Pending) {
				await completeJob(trx, job.id);
				log.info({ status: form.status }, "form no longer pending, skipping transform");
				return { outcome: "success" };
			}

			const submission = await getSubmission(trx, job.submission_id);
			const result = transform(submission.payload, submission.application_reference);

			if (!result.ok) {
				// Bad data goes to review, not retry.
				await markFormNeedsReview(trx, form.id, result.issues.join("; "));
				await completeJob(trx, job.id);
				log.info("form needs review");
				return { outcome: "success" };
			}

			await saveTransformedForm(trx, form.id, result.form);
			// The email doesn't wait for geocoding.
			await enqueueFormJob(trx, job, form.id, "geocode", retryWindowMs);
			await enqueueFormJob(trx, job, form.id, "send_email", retryWindowMs);
			await completeJob(trx, job.id);
			log.info("form transformed");
			return { outcome: "success" };
		});
}

// The form is created at ingest. Lock it so a reclaimed job can't run alongside.
function lockForm(trx: Trx, formId: string) {
	return trx
		.selectFrom("forms")
		.select(["id", "status"])
		.where("id", "=", formId)
		.forUpdate()
		.executeTakeFirstOrThrow();
}

// Only submissions with a reference get a transform job.
function getSubmission(trx: Trx, submissionId: string) {
	return trx
		.selectFrom("submissions")
		.select(["application_reference", "payload"])
		.where("id", "=", submissionId)
		.where("application_reference", "is not", null)
		.$narrowType<{ application_reference: NotNull }>()
		.executeTakeFirstOrThrow();
}

async function markFormNeedsReview(trx: Trx, formId: string, reason: string): Promise<void> {
	await trx
		.updateTable("forms")
		.set({
			status: FormStatus.NeedsReview,
			status_reason: reason,
			updated_at: new Date(),
		})
		.where("id", "=", formId)
		.execute();
}

async function saveTransformedForm(trx: Trx, formId: string, data: TransformedForm): Promise<void> {
	const postcodeId = await upsertPostcode(trx, data.postcode);
	await trx
		.updateTable("forms")
		.set({
			...toFormColumns(data, postcodeId),
			status: FormStatus.Transformed,
			status_reason: null,
			updated_at: new Date(),
		})
		.where("id", "=", formId)
		.execute();
}

// Inserts the postcode if new and returns its id either way. The no-op update makes
// RETURNING yield the existing row on conflict.
async function upsertPostcode(trx: Trx, postcode: string): Promise<string> {
	const row = await trx
		.insertInto("postcodes")
		.values({ postcode })
		.onConflict((oc) => oc
			.column("postcode")
			.doUpdateSet({ postcode: (eb) => eb.ref("excluded.postcode") }))
		.returning("id")
		.executeTakeFirstOrThrow();
	return row.id;
}

function toFormColumns(data: TransformedForm, postcodeId: string): Updateable<FormsTable> {
	return {
		session_id: data.sessionId,
		application_reference: data.applicationReference,
		first_name: data.firstName,
		last_name: data.lastName,
		email: data.email,
		gender: data.gender,
		date_of_birth: data.dateOfBirth,
		phone_number: data.phoneNumber ?? null,
		mobile_number: data.mobileNumber,
		address_line_1: data.addressLine1,
		address_line_2: data.addressLine2,
		address_line_3: data.addressLine3 ?? null,
		postcode_id: postcodeId,
		country: data.country,
	};
}
