import { createHash } from "node:crypto";
import canonicalize from "canonicalize";

export function hashPayload(payload: unknown): string {
	return createHash("sha256")
		.update(canonicalize(payload) as string)
		.digest("hex");
}

// Trimmed, uppercased application_reference, or null.
export function extractApplicationReference(payload: Record<string, unknown>): string | null {
	const value = payload.application_reference;
	if (typeof value !== "string" || value.trim() === "") {
		return null;
	}
	return value
		.trim()
		.toUpperCase();
}
