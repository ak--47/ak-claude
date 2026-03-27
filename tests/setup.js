/**
 * Jest setup file for all tests.
 *
 * Toggle USE_VERTEX to switch between Vertex AI (GCP billing) and direct API key auth.
 * When true, tests use Vertex AI via Application Default Credentials —
 * no ANTHROPIC_API_KEY required (auth via `gcloud auth application-default login`).
 * When false, tests use ANTHROPIC_API_KEY from .env.
 */

import dotenv from 'dotenv';
dotenv.config({ quiet: true });

// ─── Toggle this flag ────────────────────────────────────────────────────────
const USE_VERTEX = true;
// ─────────────────────────────────────────────────────────────────────────────

const TEST_MODEL = 'claude-haiku-4-5-20251001';

/** Shared base options for all test constructors */
let BASE_OPTIONS;

if (USE_VERTEX) {
	BASE_OPTIONS = {
		modelName: 'claude-3-5-haiku@20241022',
		vertexai: true,
		vertexProjectId: 'mixpanel-claude-code',
		vertexRegion: 'us-east5',
		logLevel: 'warn'
	};
} else {
	const { ANTHROPIC_API_KEY } = process.env;
	if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is required when USE_VERTEX is false");
	// Delete from env so tests that check env-based auth don't accidentally pick it up
	delete process.env.ANTHROPIC_API_KEY;
	BASE_OPTIONS = {
		modelName: TEST_MODEL,
		apiKey: ANTHROPIC_API_KEY,
		logLevel: 'warn'
	};
}

export { BASE_OPTIONS, USE_VERTEX, TEST_MODEL };

// Set test timeout globally
if (typeof jest !== 'undefined') {
	jest.setTimeout(30000);
}

// Global test helpers
global.delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
