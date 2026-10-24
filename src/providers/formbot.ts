import type { TransformedForm } from "../forms/validationSchemas";
import type { HttpResponse } from "./httpresponse";

export async function deliverToFormBot(
	_form: TransformedForm & {
		latitude: number;
		longitude: number;
	},
): Promise<HttpResponse<void>> {
	return {
		statusCode: 200,
	};
}
