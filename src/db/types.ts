import type { ColumnType, Generated } from "kysely";

// pg returns numeric as a string.
type Numeric = ColumnType<string, number | string, number | string>;

// Processing stage only.
export enum FormStatus {
	Pending = "pending",
	Transformed = "transformed",
	Enriched = "enriched",
	NeedsReview = "needs_review",
	Failed = "failed",
}

export enum JobStatus {
	Pending = "pending",
	Running = "running",
	Succeeded = "succeeded",
	Dead = "dead",
}

export type Gender = "male" | "female" | "prefer-not-to-say";
export type JobType = "transform" | "geocode" | "send_email" | "deliver_formbot";

export interface SubmissionsTable {
	id: Generated<string>;
	application_reference: string | null;
	payload_hash: string;
	payload: unknown;
	duplicate_count: Generated<number>;
	received_at: Generated<Date>;
	last_seen_at: Generated<Date>;
}

// One row per normalised postcode; coordinates are a geocoder cache.
export interface PostcodesTable {
	id: Generated<string>;
	postcode: string;
	latitude: Numeric | null;
	longitude: Numeric | null;
	geocoded_at: Date | null;
	created_at: Generated<Date>;
}

export interface FormsTable {
	id: Generated<string>;
	application_reference: string | null;
	submission_id: string;
	session_id: string | null;
	first_name: string | null;
	last_name: string | null;
	email: string | null;
	gender: Gender | null;
	date_of_birth: Date | null;
	phone_number: string | null;
	mobile_number: string | null;
	address_line_1: string | null;
	address_line_2: string | null;
	address_line_3: string | null;
	postcode_id: string | null;
	country: string | null;
	status: FormStatus;
	status_reason: string | null;
	has_conflicting_versions: Generated<boolean>;
	formbot_delivered_at: Date | null;
	email_sent_at: Date | null;
	created_at: Generated<Date>;
	updated_at: Generated<Date>;
}

export interface JobsTable {
	id: Generated<string>;
	submission_id: string;
	form_id: string;
	type: JobType;
	status: Generated<JobStatus>;
	attempts: Generated<number>;
	run_at: Generated<Date>;
	deadline_at: Date;
	locked_at: Date | null;
	last_error: string | null;
	created_at: Generated<Date>;
}

export interface Database {
	submissions: SubmissionsTable;
	postcodes: PostcodesTable;
	forms: FormsTable;
	jobs: JobsTable;
}
