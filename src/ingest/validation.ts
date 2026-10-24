export type IngestValidation =
	| { ok: true; payload: Record<string, unknown> }
	| { ok: false; error: string };

// The only check on arrival; the transform checks the rest.
export function validateIngestBody(body: unknown): IngestValidation {
	if (body === null || typeof body !== "object" || Array.isArray(body)) {
		return { ok: false, error: "Body must be a JSON object" };
	}
	return { ok: true, payload: body as Record<string, unknown> };
}
