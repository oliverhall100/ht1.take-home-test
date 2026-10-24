import { normalisePostcode, transform, TransformResult } from "../../src/forms/transform";
import personOne from "../../src/forms/examples/person_one.json";
import personTwo from "../../src/forms/examples/person_two.json";

const REF_KEY = "GRU-123089-2026";

function formOf(result: TransformResult) {
	if (!result.ok) {
		throw new Error(result.issues.join("; "));
	}
	return result.form;
}

function issuesOf(result: TransformResult) {
	if (result.ok) {
		throw new Error("expected issues");
	}
	return result.issues;
}

describe("transform", () => {
	it("maps person_one", () => {
		const form = formOf(transform(personOne, REF_KEY));
		expect(form).toMatchObject({
			firstName: "John",
			lastName: "Doe",
			gender: "male",
			postcode: "E154BZ",
		});
		expect(form.dateOfBirth.toISOString()).toBe("1990-01-01T00:00:00.000Z");
	});

	it("splits multi-part names, maps other gender and leaves a missing line undefined", () => {
		const form = formOf(transform(personTwo, REF_KEY));
		expect(form).toMatchObject({
			firstName: "Andy James",
			lastName: "Smith-Jones",
			gender: "prefer-not-to-say",
		});
		expect(form.addressLine3).toBeUndefined();
	});

	it("collects all issues", () => {
		const issues = issuesOf(
			transform(
				{
					...personOne,
					name: "Cher",
					date_of_birth: "2023-02-30",
				},
				REF_KEY,
			),
		);
		expect(issues).toEqual(
			expect.arrayContaining([
				expect.stringMatching(/^firstName:/),
				expect.stringMatching(/^dateOfBirth:/),
			]),
		);
	});

	it("rejects an invalid postcode", () => {
		const issues = issuesOf(
			transform(
				{
					...personOne,
					address: {
						...personOne.address,
						postcode: "NOT A POSTCODE",
					},
				},
				REF_KEY,
			),
		);
		expect(issues).toEqual([expect.stringMatching(/^postcode:/)]);
	});
});

describe("normalisePostcode", () => {
	it.each([
		["E15 4BZ", "E154BZ"],
		["e15 4bz", "E154BZ"],
		["  e15   4Bz ", "E154BZ"],
		["SW1A1AA", "SW1A1AA"],
	])("normalises %j to %j", (input, expected) => {
		expect(normalisePostcode(input)).toBe(expected);
	});

	it.each([undefined, "", "   "])("returns undefined for %j", (input) => {
		expect(normalisePostcode(input)).toBeUndefined();
	});
});
