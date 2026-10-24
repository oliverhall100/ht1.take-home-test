import { createApp } from "./app";
import { loadConfig } from "./config";
import { createDb } from "./db/client";
import { createIngestService } from "./ingest/service";
import { createDeliverFormbotHandler } from "./jobs/handlers/deliverFormbot";
import { createGeocodeHandler } from "./jobs/handlers/geocode";
import { createSendEmailHandler } from "./jobs/handlers/sendEmail";
import { createTransformHandler } from "./jobs/handlers/transform";
import { createRunner } from "./jobs/runner";
import { createLogger } from "./logger";
import { deliverToFormBot } from "./providers/formbot";
import { lookupPostcode } from "./providers/idealpostcodes";
import { sendEmail } from "./providers/sendgrid";

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL);
const db = createDb(config.DATABASE_URL);
const ingestService = createIngestService({
	db,
	retryWindowMs: config.RETRY_WINDOW_MS,
});

createApp({ ingestService, logger })
	.listen(config.PORT, () => {
		logger.info({ port: config.PORT }, "API listening");
	});

// API and job runner share one process for now.
createRunner({
	db,
	logger,
	handlers: {
		transform: createTransformHandler({
			logger,
			retryWindowMs: config.RETRY_WINDOW_MS,
		}),
		geocode: createGeocodeHandler({
			lookupPostcode,
			retryWindowMs: config.RETRY_WINDOW_MS,
		}),
		send_email: createSendEmailHandler({
			sendEmail,
			emailTo: config.EMAIL_TO,
			emailFrom: config.EMAIL_FROM,
		}),
		deliver_formbot: createDeliverFormbotHandler({
			deliverToFormBot,
		}),
	},
	pollIntervalMs: config.POLL_INTERVAL_MS,
	staleJobMs: config.STALE_JOB_MS,
})
	.start();
