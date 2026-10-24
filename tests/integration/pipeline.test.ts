import { sql } from "kysely";
import pino from "pino";
import { createDb } from "../../src/db/client";
import { migrate } from "../../src/db/migrate";
import { JobStatus } from "../../src/db/types";
import { createIngestService } from "../../src/ingest/service";
import { createDeliverFormbotHandler } from "../../src/jobs/handlers/deliverFormbot";
import { createGeocodeHandler } from "../../src/jobs/handlers/geocode";
import { createSendEmailHandler } from "../../src/jobs/handlers/sendEmail";
import { createTransformHandler } from "../../src/jobs/handlers/transform";
import { createRunner } from "../../src/jobs/runner";
import personOne from "../../src/forms/examples/person_one.json";
import personTwo from "../../src/forms/examples/person_two.json";
import personThree from "../../src/forms/examples/person_three.json";

const databaseUrl = process.env.TEST_DATABASE_URL ?? "postgres://forms:forms@localhost:5432/forms_test";
const retryWindowMs = 3_600_000;
const logger = pino({ level: "silent" });
const db = createDb(databaseUrl);
const ingestService = createIngestService({
	db,
	retryWindowMs,
});

// Returns queued status codes, then 200.
let geocoderStatuses: number[] = [];
let geocoderCalls = 0;
const fakeLookupPostcode = async () => {
	geocoderCalls += 1;
	const statusCode = geocoderStatuses.shift() ?? 200;
	return {
		statusCode,
		body: statusCode === 200 ? { longitude: 50.05, latitude: -5.05 } : undefined,
	};
};

let emailCalls = 0;
const fakeSendEmail = async () => {
	emailCalls += 1;
	return { statusCode: 200 };
};

let formBotCalls = 0;
const fakeDeliverToFormBot = async () => {
	formBotCalls += 1;
	return { statusCode: 200 };
};

const runner = createRunner({
	db,
	logger,
	handlers: {
		transform: createTransformHandler({
			logger,
			retryWindowMs,
		}),
		geocode: createGeocodeHandler({
			lookupPostcode: fakeLookupPostcode,
			retryWindowMs,
		}),
		send_email: createSendEmailHandler({
			sendEmail: fakeSendEmail,
			emailTo: "happyforms@bots.com",
			emailFrom: "noreply@example.com",
		}),
		deliver_formbot: createDeliverFormbotHandler({
			deliverToFormBot: fakeDeliverToFormBot,
		}),
	},
	pollIntervalMs: 0,
	staleJobMs: 300_000,
});

beforeAll(async () => {
	await migrate(databaseUrl);
});

beforeEach(async () => {
	geocoderStatuses = [];
	geocoderCalls = 0;
	emailCalls = 0;
	formBotCalls = 0;
	await sql`TRUNCATE jobs, forms, postcodes, submissions`.execute(db);
});

afterAll(async () => {
	await db.destroy();
});

const onlyForm = () => db
	.selectFrom("forms")
	.selectAll()
	.executeTakeFirstOrThrow();

const allPostcodes = () => db
	.selectFrom("postcodes")
	.selectAll()
	.execute();

const jobOfType = (type: "geocode" | "send_email" | "deliver_formbot") => db
	.selectFrom("jobs")
	.selectAll()
	.where("type", "=", type)
	.executeTakeFirst();

const runUntilIdle = async () => {
	while (await runner.runOnce()) {
	}
};

describe("job pipeline", () => {
	it.each([
		["person_one", personOne, "E154BZ"],
		["person_two", personTwo, "BS11AA"],
		["person_three", personThree, "SW1A1AA"],
	])("completes %s end to end with one email and one FORM-BOT delivery", async (_name, person, postcode) => {
		await ingestService.ingest(person);
		await runUntilIdle();

		const form = await onlyForm();
		expect(form.status).toBe("enriched");
		const postcodes = await allPostcodes();
		expect(postcodes).toHaveLength(1);
		expect(postcodes[0]).toMatchObject({
			id: form.postcode_id,
			postcode,
			latitude: "-5.05",
			longitude: "50.05",
		});
		expect(form.formbot_delivered_at).toBeInstanceOf(Date);
		expect(form.email_sent_at).toBeInstanceOf(Date);
		expect(emailCalls).toBe(1);
		expect(formBotCalls).toBe(1);
	});

	it("stores a postcode once and geocodes it once across forms", async () => {
		await ingestService.ingest(personOne);
		await runUntilIdle();
		await ingestService.ingest({
			...personOne,
			application_reference: "OTHER-REF-1",
			address: {
				...personOne.address,
				postcode: " e15  4bz ",
			},
		});
		await runUntilIdle();

		const forms = await db
			.selectFrom("forms")
			.select(["status", "postcode_id"])
			.execute();
		expect(forms).toHaveLength(2);
		expect(forms.every((f) => f.status === "enriched")).toBe(true);
		expect(new Set(forms.map((f) => f.postcode_id)).size).toBe(1);
		expect(await allPostcodes()).toHaveLength(1);
		expect(geocoderCalls).toBe(1);
		expect(formBotCalls).toBe(2);
	});

	it("retries a failed geocode, then completes", async () => {
		geocoderStatuses = [500];
		await ingestService.ingest(personOne);
		await runUntilIdle();

		expect(await jobOfType("geocode")).toMatchObject({
			status: "succeeded",
			attempts: 2,
		});
		expect((await onlyForm()).formbot_delivered_at).toBeInstanceOf(Date);
		expect((await allPostcodes())[0].geocoded_at).toBeInstanceOf(Date);
	});

	it("never delivers a form to FORM-BOT twice", async () => {
		await ingestService.ingest(personOne);
		await runUntilIdle();
		await db
			.updateTable("jobs")
			.set({
				status: JobStatus.Pending,
				run_at: new Date(),
			})
			.where("type", "=", "deliver_formbot")
			.execute();

		await runUntilIdle();

		expect(formBotCalls).toBe(1);
		expect((await jobOfType("deliver_formbot"))?.status).toBe("succeeded");
	});

	it("flags a conflicting version for review, keeps the original submission and halts the pipeline", async () => {
		const first = await ingestService.ingest(personOne);
		await ingestService.ingest({
			...personOne,
			email: "changed@example.com",
		});

		await runUntilIdle();

		expect(await onlyForm()).toMatchObject({
			has_conflicting_versions: true,
			status: "needs_review",
			submission_id: first.submissionId,
			email: null,
		});
		expect(emailCalls).toBe(0);
		expect(formBotCalls).toBe(0);
	});

	it("marks the job dead and the form failed once the retry window is exhausted", async () => {
		geocoderStatuses = [500];
		await ingestService.ingest(personOne);
		await runner.runOnce();
		await db
			.updateTable("jobs")
			.set({ deadline_at: new Date(Date.now() - 1000) })
			.where("type", "=", "geocode")
			.execute();

		await runUntilIdle();

		expect((await jobOfType("geocode"))?.status).toBe("dead");
		expect((await onlyForm()).status).toBe("failed");
		expect(formBotCalls).toBe(0);
	});
});
