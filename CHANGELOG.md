# Changelog

## 0.2.0

Feature request from a downstream consumer (`smarterchild/agent`, Vertex AI).
**Minor** bump — the Claude 5-family parameter gating changes what goes on the
wire (see "Behavior changes" below).

### Behavior changes (read before upgrading)
- **Claude 5-family models no longer receive `temperature` / `top_p` / `top_k`.**
  Fable 5, Mythos 5, Opus 5, Opus 4.8, Opus 4.7, and Sonnet 5 return a hard 400
  on any of these. ak-claude now drops them (one `log.debug` naming the dropped
  keys) instead of failing the call. Pre-5 models are unaffected. Previously
  these models were unusable without monkey-patching `BaseClaude`.
- **`thinking: { type: 'enabled', budget_tokens: N }` is translated on the
  Claude 5 family.** That shape also 400s there. It now becomes
  `thinking: { type: 'adaptive' }` + `output_config: { effort }` using the
  mapping below (logged at debug). Opus 4.6 / Sonnet 4.6 keep the legacy shape
  by default — opt in with `adaptiveThinking: true` (this is what silences
  Anthropic's `budget_tokens` deprecation warning). The default flips in the
  next major.

  | `budget_tokens` | effort |
  |---|---|
  | `0` / falsy | thinking omitted entirely |
  | 1–2048 | `low` |
  | 2049–8192 | `medium` |
  | 8193–24576 | `high` |
  | > 24576 | `xhigh` |

- **`temperature: null` / `topP: null` / `topK: null` now mean "never send".**
  Previously `null` collapsed into the default (`temperature` → `0.7`).
  `undefined` still means "use the default".
- **`top_k` is now suppressed whenever thinking is active**, matching
  `temperature`/`top_p`. It previously escaped the guard in `Chat`, `ToolAgent`,
  `CodeAgent`, and `RagAgent` (but not `Message`/`Transformer`) — the same config
  produced different wire params depending on which class you used.
- **`gemini`-style tool declarations with no parameter schema now throw at
  construction.** `ToolAgent` previously forwarded `input_schema: undefined` to
  the API, producing an opaque 400. For a no-argument tool pass
  `{ type: 'object', properties: {} }`.

### Added
- **`effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max'`** on every class. Sets
  `thinking: { type: 'adaptive' }` + `output_config: { effort }`. Same option
  name as ak-gemini (which maps it to `thinkingConfig.thinkingLevel`).
  `xhigh` is not valid on Opus 4.6 / Sonnet 4.6 and clamps to `high` with a
  warning. An unrecognized level throws at construction.
- **`adaptiveThinking: boolean`** — opt in to `budget_tokens` → adaptive
  translation on the 4.6 family (default `false`).
- **`cacheTtl: '5m' | '1h'`** — emits `cache_control: { type: 'ephemeral', ttl }`
  and bills cache writes correctly: **1.25× input at 5m, 2× at 1h.**
  `computeCost(..., { cacheTtl: '1h' })` exposes the same knob.
- **`thinking.display`** (`'omitted'` default on the 5 family, `'summarized'`
  opt-in) passes through verbatim on both the adaptive and translated paths.
- **Pricing for the current flagships:** `claude-opus-5`, `claude-mythos-5`,
  `claude-fable-5`, `claude-opus-4-8`, `claude-opus-4-7`, `claude-sonnet-5`.
  `claude-opus-5` was previously absent from `MODEL_PRICING` *and* unmatched by
  the family regex, so cost came back `null` on the flagship model.
- **Sonnet 5 introductory pricing** ($2/$10 per M through 2026-08-31, then
  $3/$15) via a date-windowed table entry. `resolvePricing(id, { at })` and
  `computeCost(..., { at })` accept an explicit date for back-dated reporting.
- **New exports:** `MODEL_PRICING_AS_OF`, `EFFORT_LEVELS`, `budgetTokensToEffort()`.
  `resolvePricing()` now returns `asOf` (and `introUntil` inside an intro window).
- **Legible Vertex 403s.** A `403` on a `fable`/`mythos` model is rethrown with
  the `gcloud beta services vertex-ai publisher-models set-publisher-model-config`
  command needed to enable publisher data sharing (original error preserved on
  `.cause`).

### Fixed
- Sampling and thinking params are now built by two shared `BaseClaude` methods
  (`_applySamplingParams` / `_applyThinkingParams`) called from all five call
  sites (`_sendMessage`, `_streamMessage`, `Message`, `Transformer._statelessSend`,
  `cli.js`). These four had drifted apart.
- `_applyThinkingParams` **merges** into an existing `output_config` rather than
  replacing it, so `responseSchema` (`output_config.format`) and `effort` coexist.
- **`getLastUsage()` now reports cache tokens.** `Chat`, `ToolAgent`, `CodeAgent`,
  `RagAgent`, and `Transformer` seeded `_cumulativeUsage` without
  `cacheCreationTokens` / `cacheReadTokens`, and `Transformer` did not accumulate
  them across validation retries — so a retried transform reported cumulative
  prompt tokens alongside last-call cache tokens, understating `estimatedCost`.
  Per-call `result.usage` was already correct.

### Notes
- **Sonnet 5 uses a new tokenizer that produces roughly 30% more tokens** than
  Sonnet 4.6 for the same text. This affects cost projections, `maxTokens`
  sizing, and any upstream chunker. `estimate()` calls `countTokens()` and is
  accurate; the local character heuristics are not.
- `null` from `resolvePricing()` / `usage.estimatedCost` means the model's
  pricing is **unknown** — it does not mean the call was free.

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
