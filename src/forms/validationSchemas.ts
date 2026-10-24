import { z } from "zod";

// Normalised form only (see normalisePostcode); matches the postcodes table CHECK.
const UK_POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/;

export const ingestedFormSchema = z
	.object({
		session_id: z.string().optional(),
		application_reference: z.string().optional(),
		name: z.string().optional(),
		email: z.string().optional(),
		gender: z.string().optional(),
		date_of_birth: z.string().optional(),
		phone_number: z.string().optional(),
		mobile_number: z.string().optional(),
		address: z
			.object({
				address_line_1: z.string().optional(),
				address_line_2: z.string().optional(),
				address_line_3: z.string().optional(),
				postcode: z.string().optional(),
				country: z.string().optional(),
			})
			.passthrough()
			.optional(),
	})
	.passthrough();

// longitude/latitude are omitted: the transform runs before geocoding.
export const transformedFormSchema = z.object({
	sessionId: z.string().min(1),
	applicationReference: z.string().min(1),
	firstName: z.string().min(1),
	lastName: z.string().min(1),
	email: z.string().email(),
	gender: z.enum(["male", "female", "prefer-not-to-say"]),
	dateOfBirth: z
		.string()
		.date()
		.transform((s) => new Date(`${s}T00:00:00Z`)),
	phoneNumber: z.string().optional(),
	mobileNumber: z.string(),
	addressLine1: z.string(),
	addressLine2: z.string(),
	addressLine3: z.string().optional(),
	postcode: z.string().regex(UK_POSTCODE),
	country: z.string(),
});

export type IngestedForm = z.infer<typeof ingestedFormSchema>;
export type TransformedForm = z.infer<typeof transformedFormSchema>;
