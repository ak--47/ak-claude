# Changelog

## 0.1.0

Fixes from a downstream consumer's adversarial review. **Minor** bump — includes
behavior changes (see "Behavior changes" below).

### Behavior changes (read before upgrading)
- **Vertex default region `us-east5` → `global`.** Existing Vertex consumers with
  no explicit `vertexRegion`/`GOOGLE_CLOUD_LOCATION` are re-routed to the global
  endpoint on upgrade. `global` serves the Claude 5-family, routes dynamically,
  and carries no 10% regional premium. **If you require data residency, VPC-SC, or
  regional provisioned throughput, set `vertexRegion` (or `GOOGLE_CLOUD_LOCATION`)
  explicitly.** Precedence: option > env > `global`. The resolved region is logged
  at debug; a warning fires when a Claude 5-family model is paired with a specific
  regional endpoint.
- **`Message` Vertex structured output is now validated.** Previously any
  parseable JSON came back as `result.data`. On the Vertex prompt-paste fallback,
  output is now validated against `responseSchema`; on failure it retries with
  error feedback (`validationRetries`, default 2) and then returns
  `data: null` + `result.validationErrors` — never a schema-invalid object. To
  restore return-what-parsed behavior, set `validationMode: 'warn'` (returns the
  parsed data plus `validationErrors`). `validationRetries: 0` disables retries.
- **`Message.result.usage.promptTokens`/`responseTokens` are cumulative across
  retry attempts** on the Vertex fallback path (were per-call). Up to 3 API calls
  per `send()` by default on that path (`validationRetries: 2`).

### Added
- **`usage.estimatedCost`** — every `send()` result and `getLastUsage()` include
  an estimated USD cost from `MODEL_PRICING` (`null` when unpriced). Includes
  Anthropic cache-token billing (cache-write 1.25× input, cache-read 0.1× input).
- **Concurrency-safe per-call usage.** `Message.send()` returns `result.usage`
  computed synchronously from that call's own response(s). `getLastUsage()` still
  reflects the instance's last call and is unsafe across concurrent sends — use
  `result.usage`.
- **`Message` options:** `validationMode: 'strict' | 'warn'`,
  `vertexNativeStructuredOutput` (opt in to native `output_config` on Vertex —
  GA but gated by the org policy `constraints/vertexai.allowedPartnerModelFeatures`).
- **Pricing helpers exported:** `MODEL_PRICING`, `resolvePricing()`,
  `computeCost()`. `resolvePricing` resolves Vertex `@YYYYMMDD` and hyphen-dated
  snapshots to bare-id pricing.
- **`validateSchema()`** JSON-Schema validator exported (`type`/`required`/
  `properties`/`additionalProperties`/`items`/`enum`/`nullable`; other keywords
  are pass-through).

### Fixed
- `estimateCost()` now uses `resolvePricing()` and returns `null` cost fields for
  unknown models (was `0`).
- Bare `claude-opus-4-5` / `claude-sonnet-4-5` ids now resolve pricing.
- `estimatedCost` no longer returns `null` for a priced model when the API echoes
  a date-suffixed build id.
- `Message` on Vertex no longer sends `temperature` + `top_p` together (Vertex
  rejects the pair) — prefers `temperature`, matching the base class.

### Dependencies
- `@anthropic-ai/sdk` `^0.110.0` → `^0.112.2` (no breaking changes to the used
  surface). `@anthropic-ai/vertex-sdk` remains `^0.19.0` (already latest).
