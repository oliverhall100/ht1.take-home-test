import pino, { Logger } from "pino";

// Log ids only, never payloads. Redaction is a fallback.
const REDACT_PATHS = [
	"*.name",
	"*.email",
	"*.first_name",
	"*.last_name",
	"*.firstName",
	"*.lastName",
	"*.date_of_birth",
	"*.dateOfBirth",
	"*.phone_number",
	"*.mobile_number",
	"*.phoneNumber",
	"*.mobileNumber",
	"*.address",
	"*.address_line_1",
	"*.address_line_2",
	"*.address_line_3",
	"*.postcode",
	"*.payload",
];

export function createLogger(level: string): Logger {
	return pino({ level, redact: { paths: REDACT_PATHS, censor: "[REDACTED]" } });
}
