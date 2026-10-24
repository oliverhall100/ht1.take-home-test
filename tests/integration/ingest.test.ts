import request from "supertest";
import { sql } from "kysely";
import pino from "pino";
import { createApp } from "../../src/app";
import { createDb } from "../../src/db/client";
import { migrate } from "../../src/db/migrate";
import { JobStatus } from "../../src/db/types";
import { createIngestService } from "../../src/ingest/service";
import personOne from "../../src/forms/examples/person_one.json";

const databaseUrl = process.env.TEST_DATABASE_URL ?? "postgres://forms:forms@localhost:5432/forms_test";
const db = createDb(databaseUrl);
const app = createApp({
	ingestService: createIngestService({
		db,
		retryWindowMs: 3_600_000,
	}),
	logger: pino({ level: "silent" }),
});

beforeAll(async () => {
	await migrate(databaseUrl);
});

beforeEach(async () => {
	await sql`TRUNCATE jobs, forms, postcodes, submissions`.execute(db);
});

afterAll(async () => {
	await db.destroy();
});

const submissions = () => db
	.selectFrom("submissions")
	.selectAll()
	.execute();

const transformJobs = () => db
	.selectFrom("jobs")
	.selectAll()
	.where("type", "=", "transform")
	.where("status", "=", JobStatus.Pending)
	.execute();

const postIngest = (body: object) => request(app)
	.post("/ingest")
	.send(body);

describe("POST /ingest", () => {
	it("stores a new submission, creates a pending form and enqueues one linked transform job", async () => {
		const res = await postIngest(personOne);

		expect(res.status).toBe(202);
		const [submission] = await submissions();
		expect(res.body).toEqual({ submissionId: submission.id });
		const form = await db
			.selectFrom("forms")
			.selectAll()
			.executeTakeFirstOrThrow();
		expect(form).toMatchObject({
			status: "pending",
			submission_id: submission.id,
		});
		const jobs = await transformJobs();
		expect(jobs).toHaveLength(1);
		expect(jobs[0].form_id).toBe(form.id);
	});

	it("counts an exact redelivery as a duplicate without a new job", async () => {
		const first = await postIngest(personOne);
		const res = await postIngest(personOne);

		expect(res.status).toBe(200);
		expect(res.body).toEqual({
			submissionId: first.body.submissionId,
			duplicate: true,
		});
		const rows = await submissions();
		expect(rows).toHaveLength(1);
		expect(rows[0].duplicate_count).toBe(1);
		expect(await transformJobs()).toHaveLength(1);
	});

	it("stores a submission without a reference as a needs_review form with no transform", async () => {
		const { application_reference: _omitted, ...withoutReference } = personOne;
		const res = await postIngest(withoutReference);

		expect(res.status).toBe(202);
		const [submission] = await submissions();
		expect(submission.application_reference).toBeNull();
		const form = await db
			.selectFrom("forms")
			.selectAll()
			.executeTakeFirstOrThrow();
		expect(form).toMatchObject({
			application_reference: null,
			submission_id: submission.id,
			status: "needs_review",
			status_reason: "missing application_reference",
		});
		expect(await transformJobs()).toHaveLength(0);
	});

	it("stores a changed version of the same application but queues no transform and flags the form", async () => {
		const first = await postIngest(personOne);
		const res = await postIngest({
			...personOne,
			email: "changed@example.com",
		});

		expect(res.status).toBe(202);
		expect(await submissions()).toHaveLength(2);
		expect(await transformJobs()).toHaveLength(1);
		const forms = await db
			.selectFrom("forms")
			.selectAll()
			.execute();
		expect(forms).toHaveLength(1);
		expect(forms[0]).toMatchObject({
			submission_id: first.body.submissionId,
			has_conflicting_versions: true,
			status: "needs_review",
		});
	});
});
