import type { ZodError } from "zod";
import { ingestedFormSchema, transformedFormSchema, TransformedForm } from "./validationSchemas";

export type TransformResult = { ok: true; form: TransformedForm } | { ok: false; issues: string[] };

// Uppercase with all whitespace removed, e.g. " e15 4bz " → "E154BZ".
export function normalisePostcode(postcode?: string): string | undefined {
	return postcode?.replace(/\s+/g, "").toUpperCase() || undefined;
}

// The reference comes from the submission, not the payload.
export function transform(payload: unknown, applicationReference: string): TransformResult {
	const parsed = ingestedFormSchema.safeParse(payload);
	if (!parsed.success) {
		return {
			ok: false,
			issues: formatIssues(parsed.error),
		};
	}
	// Map renamed fields here.
	const raw = parsed.data;
	const address = raw.address ?? {};
	const result = transformedFormSchema.safeParse({
		sessionId: trim(raw.session_id),
		applicationReference,
		...splitName(raw.name),
		email: trim(raw.email),
		// Other values could go to review instead.
		gender: raw.gender === "male" || raw.gender === "female" ? raw.gender : "prefer-not-to-say",
		// Other date formats could be parsed here.
		dateOfBirth: trim(raw.date_of_birth),
		// Not validated.
		phoneNumber: trim(raw.phone_number),
		mobileNumber: raw.mobile_number?.trim(),
		addressLine1: trim(address.address_line_1),
		addressLine2: trim(address.address_line_2),
		addressLine3: trim(address.address_line_3),
		postcode: normalisePostcode(address.postcode),
		country: trim(address.country),
	});
	if (!result.success) {
		return {
			ok: false,
			issues: formatIssues(result.error),
		};
	}
	return {
		ok: true,
		form: result.data,
	};
}

function trim(s?: string) {
	return s?.trim() || undefined;
}

function formatIssues(error: ZodError) {
	return error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
}

function splitName(name?: string) {
	const tokens = trim(name)?.split(/\s+/) ?? [];
	return {
		firstName: tokens
			.slice(0, -1)
			.join(" ") || undefined,
		lastName: tokens.length > 1 ? tokens[tokens.length - 1] : undefined,
	};
}
