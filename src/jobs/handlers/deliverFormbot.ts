import type { NotNull, Selectable, Transaction } from "kysely";
import { Database, FormsTable, FormStatus, PostcodesTable } from "../../db/types";
import type { TransformedForm } from "../../forms/validationSchemas";
import type { HttpResponse } from "../../providers/httpresponse";
import { completeJob, JobHandler } from "../runner";

type DeliverableForm = TransformedForm & {
	latitude: number;
	longitude: number;
};

export function createDeliverFormbotHandler({
	deliverToFormBot,
}: {
	deliverToFormBot: (form: DeliverableForm) => Promise<HttpResponse<void>>;
}): JobHandler {
	return async (job, db) => {
		// Claim and complete the job before sending, so no retry or reclaim can resend.
		const deliverable = await db
			.transaction()
			.execute(async (trx) => {
				const claimed = await claimFormForDelivery(trx, job.form_id);
				await completeJob(trx, job.id);
				if (!claimed) {
					return undefined;
				}
				const postcode = await getPostcode(trx, claimed.postcode_id);
				return toDeliverableForm(claimed, postcode);
			});
		if (!deliverable) {
			// Already delivered, or no longer enriched, so skip.
			return { outcome: "success" };
		}

		// After commit, so no lock is held during the call.
		// FORM-BOT never fails, so the response isn't checked.
		await deliverToFormBot(deliverable);
		return { outcome: "success" };
	};
}

function claimFormForDelivery(trx: Transaction<Database>, formId: string) {
	const now = new Date();
	return trx
		.updateTable("forms")
		.set({
			formbot_delivered_at: now,
			updated_at: now,
		})
		.where("id", "=", formId)
		.where("formbot_delivered_at", "is", null)
		.where("status", "=", FormStatus.Enriched)
		.where("application_reference", "is not", null)
		.returningAll()
		.$narrowType<{ application_reference: NotNull }>()
		.executeTakeFirst();
}

// Only enriched forms are claimed, and those always have a geocoded postcode.
function getPostcode(trx: Transaction<Database>, postcodeId: string | null) {
	return trx
		.selectFrom("postcodes")
		.selectAll()
		.where("id", "=", postcodeId as string)
		.executeTakeFirstOrThrow();
}

function toDeliverableForm(
	form: Selectable<FormsTable> & { application_reference: string },
	postcode: Selectable<PostcodesTable>,
): DeliverableForm {
	return {
		sessionId: form.session_id,
		applicationReference: form.application_reference,
		firstName: form.first_name,
		lastName: form.last_name,
		email: form.email,
		gender: form.gender,
		dateOfBirth: form.date_of_birth,
		phoneNumber: form.phone_number ?? undefined,
		mobileNumber: form.mobile_number,
		addressLine1: form.address_line_1,
		addressLine2: form.address_line_2,
		addressLine3: form.address_line_3 ?? undefined,
		postcode: postcode.postcode,
		country: form.country,
		latitude: Number(postcode.latitude),
		longitude: Number(postcode.longitude),
	} as DeliverableForm;
}
