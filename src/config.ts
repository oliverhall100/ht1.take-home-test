import dotenv from "dotenv";

export interface Config {
	DATABASE_URL: string;
	PORT: number;
	LOG_LEVEL: string;
	POLL_INTERVAL_MS: number;
	RETRY_WINDOW_MS: number;
	STALE_JOB_MS: number;
	PROVIDER_TIMEOUT_MS: number;
	EMAIL_TO: string;
	EMAIL_FROM: string;
}

function processEnvWithDotenv(): NodeJS.ProcessEnv {
	dotenv.config({ quiet: true });
	return process.env;
}

// Loads .env only when no env is passed, so tests can pass their own.
export function loadConfig(env: NodeJS.ProcessEnv = processEnvWithDotenv()): Config {
	return {
		DATABASE_URL: env.DATABASE_URL as string,
		PORT: Number(env.PORT),
		LOG_LEVEL: env.LOG_LEVEL as string,
		POLL_INTERVAL_MS: Number(env.POLL_INTERVAL_MS),
		RETRY_WINDOW_MS: Number(env.RETRY_WINDOW_MS),
		STALE_JOB_MS: Number(env.STALE_JOB_MS),
		PROVIDER_TIMEOUT_MS: Number(env.PROVIDER_TIMEOUT_MS),
		EMAIL_TO: env.EMAIL_TO as string,
		EMAIL_FROM: env.EMAIL_FROM as string,
	};
}
