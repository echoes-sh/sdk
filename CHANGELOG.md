# Changelog

## 1.2.1

### Changed

- Session recording now depends on `@rrweb/record` and `@rrweb/types` (2.1.7) instead of the deprecated `rrweb` package (2.0.0-alpha.17). Recording options and output are unchanged.
- The CDN bundle reports `version` `1.2.1`.

## 1.2.0

Ratings and server-side experiments, following the Echoes contract for ratings and experiments (echoes-v2 `docs/ratings-and-experiments.md`). Apps on 1.0.x keep working unchanged.

### Added

- **Ratings.** `echoes.rate({ subject: { type, id, version? }, stars, comment?, userIdentifier?, metadata?, experiments? })` posts to `POST /api/v1/ratings` and resolves with `{ ratingId, updated }`. `stars` is 1–5, or `null` for a dismissal.
  - Parameters are checked before sending: the stars, `subject.type` against `^[a-z0-9_.-]{1,50}$`, `subject.id` ≤ 255, `subject.version` ≤ 50, and the trimmed comment ≤ 2000.
  - With an `experimentClient`, the visitor's experiments are added to `experiments` automatically.
  - New types: `RateParams`, `RateResult`, `RatingSubject`, `RatingStars`, `RatingExperimentRef`.
- **Local evaluation.** `ExperimentClient#evaluate(experimentKey, unitId?)` returns the variation from the cached config with the contract's bucketing rule, the same one the server runs. It is synchronous, makes no network call, and records no exposure.
  - The rule's pure functions are exported too: `bucket10k`, `variationBucket`, `pickVariation`, `evaluateExperiment`, `evaluateExperimentDetailed`, `BUCKET_COUNT`. They are also in the CDN bundle.
- `ExperimentClient#loadConfig(force?)`, `setConfig(experiments)`, `getConfig()`, and the `initialConfig` option, so that a config you cached yourself can be evaluated with no network.
- `ExperimentClient#assign(experimentKey, unitId?, { userIdentifier?, context? }?)` assigns any unit (a room id, a user id…). It sends `unitId` alongside the 1.0 `visitorId`.
- `ExperimentClient#track(…, { unitId? })` tracks events for any unit, and also sends `unitId`.
- The `storage` option: `localStorage` by default when the runtime has one, otherwise memory. `null`/`false` gives memory only, or pass your own `ExperimentStorage`. `createMemoryStorage()` is exported.
- Config types gain `kind` (`"experiment" | "flag"`) and `salt`.
- **React.** `<RatingWidget>` gives five stars, an optional comment for 1–3 stars, a thank-you, and a dismiss button that sends `stars: null`.
  - It is themeable (light/dark, `className`, `style`), and every string can be overridden through `labels`.
  - It is accessible: a radio group with arrow keys, Home/End and roving tabindex, plus labelled controls.
- `useRating(subject, options?)` returns `{ rate, dismiss, status, error, result, reset }`.
- Error codes `ORIGIN_NOT_ALLOWED`, `QUOTA_EXCEEDED`, `FORBIDDEN` and `NOT_FOUND`.
- Tests (Vitest). They include the bucketing vectors shared with the server, copied verbatim into `test/fixtures/bucketing-vectors.json`.

### Fixed

- A 403 was always reported as "API key is disabled". It is now mapped from the server's error string: `INVALID_API_KEY` for a disabled key, `ORIGIN_NOT_ALLOWED`, `QUOTA_EXCEEDED`, otherwise `FORBIDDEN`. The server's message is kept.
- HTTP errors from `send` were re-thrown as `NETWORK_ERROR`, losing their code and status. They now keep them: `INVALID_PAYLOAD`, `INVALID_API_KEY`, `RATE_LIMITED`, and so on.
- A non-JSON error page (from a proxy, for example) is reported by its status, instead of as a JSON parse error.
- The experiment client no longer breaks without `window`, `document` or `localStorage`, as in Node, edge and Convex. It reads browser context only in a browser, and a storage that throws is ignored.
- `fetchConfig()` now refreshes the cached config. A failed refetch keeps the previous config.

### Changed

- A 404 now has the code `NOT_FOUND` (it was `UNKNOWN`).
- Assigning a unit other than the client's own visitor no longer touches `getActiveExperiments()`.
- The CDN bundle reports `version` `1.2.0`.

### Unchanged

- `hashToBucket` (0–99) and `murmur3` give the same values as 1.0.
- The request and response shapes of `/api/v1/feedback`, `/api/v1/sdk/config`, `/api/v1/sdk/assign` and `/api/v1/sdk/track`. The new fields are additions.

## 1.1.0 (not published)

- Experiments (`ExperimentClient`, React hooks, CDN bundle), the `echoes init` CLI, and more analytics trackers.

## 1.0.1

- Initial public release of the feedback client, React widget and analytics.
