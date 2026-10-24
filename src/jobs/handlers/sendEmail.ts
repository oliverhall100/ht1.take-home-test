import type { Kysely, NotNull, Transaction } from "kysely";
import type { Database } from "../../db/types";
import type { HttpResponse } from "../../providers/httpresponse";
import { completeJob, JobHandler } from "../runner";

type SendEmail = (message: {
	to: string;
	from: string;
	subject: string;
	body: string;
}) => Promise<HttpResponse<void>>;

export function createSendEmailHandler({
	sendEmail,
	emailTo,
	emailFrom,
}: {
	sendEmail: SendEmail;
	emailTo: string;
	emailFrom: string;
}): JobHandler {
	return async (job, db) => {
		const form = await getForm(db, job.form_id);

		// Outside a transaction. Errors are retried.
		const response = await sendEmail({
			to: emailTo,
			from: emailFrom,
			subject: `Form ingested: ${form.application_reference}`,
			body: `Form ${form.id} ingested at ${new Date().toISOString()}`,
		});
		if (response.statusCode < 200 || response.statusCode > 299) {
			return {
				outcome: "retry",
				error: `email provider returned ${response.statusCode}`,
			};
		}

		return db
			.transaction()
			.execute(async (trx) => {
				await markEmailSent(trx, form.id);
				await completeJob(trx, job.id);
				return { outcome: "success" };
			});
	};
}

function getForm(db: Kysely<Database>, formId: string) {
	return db
		.selectFrom("forms")
		.select(["id", "application_reference"])
		.where("id", "=", formId)
		.where("application_reference", "is not", null)
		.$narrowType<{ application_reference: NotNull }>()
		.executeTakeFirstOrThrow();
}

async function markEmailSent(trx: Transaction<Database>, formId: string): Promise<void> {
	const now = new Date();
	await trx
		.updateTable("forms")
		.set({
			email_sent_at: now,
			updated_at: now,
		})
		.where("id", "=", formId)
		.execute();
}
