import type { Kysely, Transaction } from "kysely";
import { Database, FormStatus } from "../../db/types";
import type { HttpResponse } from "../../providers/httpresponse";
import { completeJob, enqueueFormJob, JobHandler } from "../runner";

type LookupPostcode = (postcode: string) => Promise<HttpResponse<{ longitude: number; latitude: number }>>;

export function createGeocodeHandler({
	lookupPostcode,
	retryWindowMs,
}: {
	lookupPostcode: LookupPostcode;
	retryWindowMs: number;
}): JobHandler {
	return async (job, db) => {
		const form = await getTransformedForm(db, job.form_id);
		if (!form) {
			// Status changed (e.g. to needs_review), so skip.
			await db
				.transaction()
				.execute((trx) => completeJob(trx, job.id));
			return { outcome: "success" };
		}

		let coordinates: { latitude: number; longitude: number } | undefined;
		if (!form.geocoded_at) {
			// Not cached. Outside a transaction, so no lock is held during the call.
			const response = await lookupPostcode(form.postcode);
			if (response.statusCode < 200 || response.statusCode > 299 || !response.body) {
				return {
					outcome: "retry",
					error: `geocoder returned ${response.statusCode}`,
				};
			}
			coordinates = response.body;
		}

		return db
			.transaction()
			.execute(async (trx) => {
				if (coordinates) {
					await cacheCoordinates(trx, form.postcodeId, coordinates.latitude, coordinates.longitude);
				}
				if (await markEnriched(trx, form.id)) {
					await enqueueFormJob(trx, job, form.id, "deliver_formbot", retryWindowMs);
				}
				await completeJob(trx, job.id);
				return { outcome: "success" };
			});
	};
}

// The form's postcode, with any coordinates already cached for it.
function getTransformedForm(db: Kysely<Database>, formId: string) {
	return db
		.selectFrom("forms")
		.innerJoin("postcodes", "postcodes.id", "forms.postcode_id")
		.select([
			"forms.id",
			"postcodes.id as postcodeId",
			"postcodes.postcode",
			"postcodes.geocoded_at",
		])
		.where("forms.id", "=", formId)
		.where("forms.status", "=", FormStatus.Transformed)
		.executeTakeFirst();
}

// Caches the coordinates. Only fills an empty row, so the first result wins.
async function cacheCoordinates(
	trx: Transaction<Database>,
	postcodeId: string,
	latitude: number,
	longitude: number,
): Promise<void> {
	await trx
		.updateTable("postcodes")
		.set({
			latitude,
			longitude,
			geocoded_at: new Date(),
		})
		.where("id", "=", postcodeId)
		.where("geocoded_at", "is", null)
		.execute();
}

// Only updates forms still in transformed.
async function markEnriched(trx: Transaction<Database>, formId: string): Promise<boolean> {
	const updated = await trx
		.updateTable("forms")
		.set({
			status: FormStatus.Enriched,
			updated_at: new Date(),
		})
		.where("id", "=", formId)
		.where("status", "=", FormStatus.Transformed)
		.executeTakeFirst();
	return updated.numUpdatedRows > 0n;
}
