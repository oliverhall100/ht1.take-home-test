import express, { NextFunction, Request, Response } from "express";
import type { Logger } from "pino";
import type { IngestService } from "./ingest/service";
import { validateIngestBody } from "./ingest/validation";

export function createApp({
	ingestService,
	logger,
}: {
	ingestService: IngestService;
	logger: Logger;
}) {
	const app = express();

	// Bad JSON returns 400; over 100kb returns 413.
	app.use(express.json({ limit: "100kb" }));

	app.post("/ingest", async (req: Request, res: Response, next: NextFunction) => {
		const validation = validateIngestBody(req.body);
		if (!validation.ok) {
			res
				.status(400)
				.json({ error: validation.error });
			return;
		}
		try {
			const { submissionId, duplicate, missingReference } = await ingestService.ingest(validation.payload);
			if (missingReference) {
				logger.warn({ submissionId, duplicate }, "submission has no application reference, needs review");
			} else {
				logger.info({ submissionId, duplicate }, "submission ingested");
			}
			if (duplicate) {
				res
					.status(200)
					.json({ submissionId, duplicate: true });
			} else {
				res
					.status(202)
					.json({ submissionId });
			}
		} catch (error) {
			next(error);
		}
	});

	app.use((
		error: { status?: number; message?: string },
		_req: Request,
		res: Response,
		_next: NextFunction,
	) => {
		const status = error.status ?? 500;
		if (status >= 500) {
			logger.error({ err: error }, "request failed");
		}
		res
			.status(status)
			.json({ error: status >= 500 ? "Internal Server Error" : error.message });
	});

	return app;
}
