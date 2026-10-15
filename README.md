# @echoessh/sdk

Official SDK for [Echoes](https://echoes.sh) - Centralized feedback platform for developers managing multiple SaaS products.

It sends **feedback** (bugs, feature requests, questions, praise), **ratings** (1–5 stars on something your app showed), and runs **experiments** (feature flags and A/B tests with deterministic assignment, evaluable locally in the browser, Node, edge or Convex).

## Installation

```bash
# Using bun
bun add @echoessh/sdk

# Using npm
npm install @echoessh/sdk

# Using yarn
yarn add @echoessh/sdk

# Using pnpm
pnpm add @echoessh/sdk
```

## Quick Start

### Basic Usage

```typescript
import { Echoes } from "@echoessh/sdk";

const echoes = new Echoes({
  apiKey: "ek_live_xxxxxxxxxxxxx",
});

// Send feedback
await echoes.send({
  category: "bug",
  message: "Button doesn't work on mobile",
  userIdentifier: "user@example.com",
  metadata: {
    browser: "Chrome",
    version: "120.0",
  },
});

// Or use convenience methods
await echoes.bug("Button doesn't work on mobile");
await echoes.feature("Add dark mode support");
await echoes.question("How do I reset my password?");
await echoes.praise("Love the new design!");

// Rate something the app showed (1–5 stars, or null when dismissed)
await echoes.rate({
  subject: { type: "room", id: "room_123", version: "3" },
  stars: 4,
  comment: "Lovely, but the sofa faces the wall",
});
```

### React Integration

```tsx
import { EchoesProvider, FeedbackWidget } from "@echoessh/sdk/react";

function App() {
  return (
    <EchoesProvider config={{ apiKey: "ek_live_xxxxxxxxxxxxx" }}>
      <YourApp />
      <FeedbackWidget
        userIdentifier="user@example.com"
        onSuccess={(id) => console.log("Feedback submitted:", id)}
      />
    </EchoesProvider>
  );
}
```

## API Reference

### `Echoes` Class

#### Constructor

```typescript
new Echoes(config: EchoesConfig)
```

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `apiKey` | `string` | Yes | - | Your Echoes API key |
| `baseUrl` | `string` | No | `https://echoes.sh` | API base URL |
| `defaultUserIdentifier` | `string` | No | - | Default user identifier |
| `defaultMetadata` | `object` | No | - | Default metadata for all feedback |
| `timeout` | `number` | No | `10000` | Request timeout in ms |
| `debug` | `boolean` | No | `false` | Enable debug logging |
| `experimentClient` | `ExperimentClient` | No | - | Adds the visitor's experiments to feedback (`_experiments` metadata) and ratings (`experiments`) |

#### Methods

##### `send(params: SendFeedbackParams): Promise<FeedbackResponse>`

Send feedback with full control over all parameters.

```typescript
await echoes.send({
  category: "bug", // "bug" | "feature" | "question" | "praise"
  message: "Something went wrong",
  userIdentifier: "user@example.com", // optional
  metadata: { page: "/dashboard" }, // optional
});
```

##### `bug(message, options?): Promise<FeedbackResponse>`

Convenience method for sending bug reports.

```typescript
await echoes.bug("Login button not working", {
  userIdentifier: "user@example.com",
});
```

##### `feature(message, options?): Promise<FeedbackResponse>`

Convenience method for sending feature requests.

##### `question(message, options?): Promise<FeedbackResponse>`

Convenience method for sending questions.

##### `praise(message, options?): Promise<FeedbackResponse>`

Convenience method for sending praise/positive feedback.

##### `withUser(userIdentifier): Echoes`

Create a new client instance with a default user identifier.

```typescript
const userEchoes = echoes.withUser("user@example.com");
await userEchoes.bug("Something broke"); // Will include user identifier
```

##### `withMetadata(metadata): Echoes`

Create a new client instance with additional default metadata.

```typescript
const pageEchoes = echoes.withMetadata({ page: "/settings" });
await pageEchoes.bug("Settings not saving"); // Will include page metadata
```

##### `withExperiments(experimentClient): Echoes`

Create a new client instance that adds the experiment client's active experiments to everything it sends.

##### `rate(params: RateParams): Promise<RateResult>`

Rate one thing the app showed (a **subject**): 1–5 stars, with an optional comment. Posts to `POST /api/v1/ratings`.

```typescript
const { ratingId, updated } = await echoes.rate({
  subject: { type: "room", id: roomId, version: "3" }, // version optional
  stars: 4,                       // 1–5, or null for "asked and dismissed"
  comment: "The sofa faces the wall", // optional, trimmed, ≤ 2000 characters
  userIdentifier: "user@example.com", // optional
  metadata: { page: "/visit" },       // optional
  experiments: [{ key: "room-agent", unitId: roomId }], // optional
});
```

- `subject.type` matches `^[a-z0-9_.-]{1,50}$`; `subject.id` is 1–255 characters; `subject.version` at most 50 (numbers are sent as strings).
- Send dismissals (`stars: null`) too, so that response rates can be read.
- **Upsert:** the same `userIdentifier` rating the same subject version again replaces the earlier rating, and `updated` is `true`. Without a `userIdentifier`, every rating is new.
- **Experiments:** each `{ key, unitId }` ties the rating to that unit's stored assignment, so results can be read per variation. When the client has an `experimentClient`, the experiments its visitor is in are added automatically (an explicit entry wins for the same key).
- A rating with a comment also creates a ticket in the project's triage (1–2 stars as `bug`, 3 as `feature`, 4–5 as `praise`). Ratings don't count toward the monthly ticket quota.
- Parameters are validated before any request; invalid ones throw `EchoesError` with code `INVALID_PAYLOAD`.

## Experiments

Feature flags and A/B tests. An experiment has weighted variations, each with a free JSON `configuration`; a **unit** (a visitor id, a user id, a room id: whatever you choose) always gets the same variation for the same experiment configuration.

```typescript
import { ExperimentClient } from "@echoessh/sdk";

const experiments = new ExperimentClient({ apiKey: "ek_live_xxx" });

// Ask the server: records exposure and stores the assignment
const variation = await experiments.getVariation("new-checkout");
if (variation?.key === "on") {
  // show the new checkout
}

// Track an event against the visitor's assignment
await experiments.track("new-checkout", "purchase", 99.99);
```

### `ExperimentClient` options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | `string` | - | Your Echoes API key |
| `baseUrl` | `string` | `https://echoes.sh` | API base URL |
| `visitorId` | `string` | persisted random id | Unit used when none is passed |
| `userIdentifier` | `string` | - | Sent with assignments |
| `storage` | `ExperimentStorage \| null \| false` | `localStorage` if any, else memory | Where the visitor id and assignments are kept. `null`/`false`: memory only |
| `initialConfig` | `ExperimentConfig[]` | - | A config to start from, so `evaluate` works with no network call |
| `timeout` | `number` | `10000` | Request timeout in ms |
| `debug` | `boolean` | `false` | Debug logging |

The client needs no `window`, `document` or `localStorage`: it works in Node, edge runtimes and Convex actions.

### Methods

| Method | Description |
|--------|-------------|
| `assign(experimentKey, unitId?, { userIdentifier?, context? }?)` | `POST /api/v1/sdk/assign`. Records exposure; later calls return the stored variation. `unitId` defaults to the visitor id. Never throws: failures answer `{ success: false, assigned: false }`. |
| `getVariation(experimentKey)` | The visitor's variation: the cached assignment if any, else `assign`. |
| `evaluate(experimentKey, unitId?)` | Local, synchronous, network-free evaluation from the cached config, with the same rule as the server. `null` when the config isn't cached, the experiment isn't running, or the unit is outside the traffic. Records no exposure. |
| `loadConfig(force?)` | Fetch `GET /api/v1/sdk/config` (the running experiments) unless cached in the last 60 s, and return it. |
| `setConfig(experiments)` / `getConfig()` | Replace or read the cached config (e.g. a copy you store yourself). |
| `track(experimentKey, eventName, value?, properties?, { unitId? }?)` | `POST /api/v1/sdk/track`, recorded against the unit's stored assignment. |
| `identify(userIdentifier)` | Set the user identifier for later calls. |
| `getActiveExperiments()` | The visitor's assignments, `{ [experimentKey]: { variationKey, assignmentId } }`. |
| `getVisitorId()` / `reset()` | Read the visitor id / forget everything stored. |

Only assignments of the client's own visitor are remembered (and added to feedback and ratings). Assigning other units, as server code does, leaves them alone.

### Server-side: a Convex action

Assign on the server with the unit you care about, fall back to local evaluation when Echoes can't be reached, and rate later against the same unit:

```typescript
// convex/rooms.ts
import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { Echoes, ExperimentClient } from "@echoessh/sdk";

const DEFAULT_MODEL = "gpt-6.1-sol";

export const pickAgent = internalAction({
  args: { roomId: v.string(), userIdentifier: v.optional(v.string()) },
  handler: async (_ctx, { roomId, userIdentifier }) => {
    const experiments = new ExperimentClient({
      apiKey: process.env.ECHOES_API_KEY!,
      storage: null, // no persistence on the server
    });

    // Records exposure; the room id is the unit.
    const assignment = await experiments.assign("room-agent", roomId, { userIdentifier });
    if (assignment.success) {
      const model = assignment.variation?.configuration?.model;
      return typeof model === "string" ? model : DEFAULT_MODEL;
    }

    // Echoes unreachable: the same rule, locally. Not counted as an exposure.
    // (Pass a config you stored yourself with `initialConfig` / `setConfig`
    // if the config endpoint can't be reached either.)
    await experiments.loadConfig();
    const local = experiments.evaluate("room-agent", roomId);
    const model = local?.configuration?.model;
    return typeof model === "string" ? model : DEFAULT_MODEL;
  },
});

export const roomReady = internalAction({
  args: { roomId: v.string(), seconds: v.number() },
  handler: async (_ctx, { roomId, seconds }) => {
    const experiments = new ExperimentClient({ apiKey: process.env.ECHOES_API_KEY!, storage: null });
    await experiments.track("room-agent", "room_ready", seconds, undefined, { unitId: roomId });
  },
});

export const rateRoom = internalAction({
  args: { roomId: v.string(), version: v.string(), stars: v.union(v.number(), v.null()), household: v.string() },
  handler: async (_ctx, { roomId, version, stars, household }) => {
    const echoes = new Echoes({ apiKey: process.env.ECHOES_API_KEY! });
    return await echoes.rate({
      subject: { type: "room", id: roomId, version },
      stars: stars as 1 | 2 | 3 | 4 | 5 | null,
      userIdentifier: household,
      experiments: [{ key: "room-agent", unitId: roomId }],
    });
  },
});
```

### The bucketing rule

`evaluate` and the server compute the same thing (see `bucket10k`, `variationBucket`, `pickVariation` and `evaluateExperiment`, all exported):

```
bucket = murmur3_32(key + ":" + unitId + (salt ? ":" + salt : ""), seed 0) mod 10000
pick   = murmur3_32("variation:" + key + ":" + unitId + (salt ? ":" + salt : ""), seed 0) mod 10000
```

A unit enters when `bucket < trafficAllocation × 100`. The variation is the first, in stored order, whose running sum of `weight / Σweights × 10000` exceeds `pick` (compared exactly, as `Σweights so far × 10000 > pick × Σweights`). A zero weight is never picked. Because the pick is a second hash, changing the traffic doesn't move units between variations. The murmur3 reads each UTF-16 code unit's low byte. `hashToBucket` (0–99) is kept unchanged for SDK 1.0 code.

### From a CDN

```html
<script src="https://unpkg.com/@echoessh/sdk/dist/experiments.min.js"></script>
<script>
  const client = EchoesExperiments.init({ apiKey: "ek_live_xxx" });
  client.getVariation("my-experiment").then((variation) => { /* … */ });
</script>
```

## React Components

#### `<EchoesProvider>`

Context provider for React applications.

```tsx
<EchoesProvider config={{ apiKey: "ek_live_xxx" }}>
  {children}
</EchoesProvider>
```

#### `<FeedbackWidget>`

Pre-built feedback form component.

```tsx
<FeedbackWidget
  userIdentifier="user@example.com"
  metadata={{ page: "/home" }}
  onSuccess={(id) => console.log(id)}
  onError={(err) => console.error(err)}
  placeholder="Tell us what you think..."
  submitText="Send Feedback"
  successText="Thanks! 🙏"
  showCategories={true}
  defaultCategory="bug"
  theme="light" // "light" | "dark"
/>
```

#### `<RatingWidget>`

Five stars, then an optional comment for 1–3 stars, then a thank-you. The dismiss button sends `stars: null` and the widget then renders nothing.

```tsx
import { RatingWidget } from "@echoessh/sdk/react";

<RatingWidget
  subject={{ type: "room", id: roomId, version: "3" }}
  userIdentifier="user@example.com"
  metadata={{ page: "/visit" }}
  experiments={[{ key: "room-agent", unitId: roomId }]}
  onRated={({ ratingId, stars, comment }) => console.log(ratingId, stars)}
  onDismiss={() => setAsked(true)}
  onError={(err) => console.error(err)}
  theme="light" // "light" | "dark"
  className="my-rating"
  style={{ maxWidth: 360 }}
  showDismiss={true}
  labels={{
    title: "Qu'en pensez-vous ?",
    star: (n) => `${n} étoile${n > 1 ? "s" : ""}`,
    dismiss: "Fermer",
    commentLabel: "Que pourrait-on améliorer ?",
    commentPlaceholder: "Facultatif",
    submit: "Envoyer",
    submitting: "Envoi…",
    skip: "Passer",
    thanks: "Merci pour votre note !",
  }}
/>
```

Every string is overridable through `labels` (defaults in `defaultRatingWidgetLabels`). The stars are a radio group: Tab focuses it, the arrow keys and Home/End move the selection, and Enter, Space or a click confirms it. Each star has an accessible name, and the thank-you is announced as a status.

## React Hooks

#### `useRating(subject, options?)`

Rate a subject from your own UI, with status and error state.

```tsx
import { useRating } from "@echoessh/sdk/react";

function ThumbsRating({ roomId }: { roomId: string }) {
  const { rate, dismiss, status, error } = useRating(
    { type: "room", id: roomId },
    { userIdentifier: "user@example.com" } // defaults for every call
  );

  if (status === "rated") return <p>Thanks!</p>;
  if (status === "dismissed") return null;

  return (
    <div>
      <button disabled={status === "submitting"} onClick={() => rate(5)}>👍</button>
      <button disabled={status === "submitting"} onClick={() => rate(1, { comment: "Not for me" })}>👎</button>
      <button onClick={() => dismiss()}>Not now</button>
      {error && <p>{error.message}</p>}
    </div>
  );
}
```

`status` is `"idle" | "submitting" | "rated" | "dismissed" | "error"`. `rate` and `dismiss` resolve with `{ ratingId, updated }` and reject with the `EchoesError`. The hook also returns `result` and `reset`.

#### Experiment hooks

`ExperimentProvider`, `useExperiment`, `useVariation`, `useFeatureFlag`, `useActiveExperiments`, `useExperimentIdentify` and `useExperimentClient` wrap an `ExperimentClient` for React.

#### `useEchoes(): Echoes`

Access the Echoes client from context.

```tsx
function MyComponent() {
  const echoes = useEchoes();

  const handleClick = async () => {
    await echoes.bug("Something went wrong");
  };

  return <button onClick={handleClick}>Report Bug</button>;
}
```

#### `useFeedback()`

Hook with loading and error states for sending feedback.

```tsx
function FeedbackForm() {
  const { send, isLoading, isSuccess, error, reset } = useFeedback();
  const [message, setMessage] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    await send({ category: "bug", message });
  };

  if (isSuccess) {
    return (
      <div>
        <p>Thanks!</p>
        <button onClick={reset}>Send more</button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
      />
      <button disabled={isLoading}>
        {isLoading ? "Sending..." : "Submit"}
      </button>
      {error && <p>{error.message}</p>}
    </form>
  );
}
```

## Error Handling

The SDK throws `EchoesError` for various error conditions:

```typescript
import { EchoesError, ErrorCodes } from "@echoessh/sdk";

try {
  await echoes.send({ category: "bug", message: "Test" });
} catch (error) {
  if (error instanceof EchoesError) {
    switch (error.code) {
      case ErrorCodes.INVALID_API_KEY:
        console.error("Check your API key");
        break;
      case ErrorCodes.RATE_LIMITED:
        console.error("Too many requests, try again later");
        break;
      case ErrorCodes.NETWORK_ERROR:
        console.error("Network error:", error.message);
        break;
    }
  }
}
```

| Code | When |
|------|------|
| `INVALID_API_KEY` | 401, or 403 "API key is disabled"; or a malformed key |
| `ORIGIN_NOT_ALLOWED` | 403 "Origin not allowed": add the origin to the project's allowed origins |
| `QUOTA_EXCEEDED` | 403 "Monthly feedback limit reached…" |
| `FORBIDDEN` | any other 403 |
| `INVALID_PAYLOAD` | 400, or parameters rejected before sending |
| `NOT_FOUND` | 404 (e.g. "Project not found") |
| `RATE_LIMITED` | 429 |
| `NETWORK_ERROR` / `TIMEOUT` | the request didn't complete |
| `UNKNOWN` | anything else |

For 403s, `error.message` is the server's own message.

## TypeScript Support

The SDK is written in TypeScript and includes full type definitions:

```typescript
import type {
  EchoesConfig,
  FeedbackCategory,
  SendFeedbackParams,
  FeedbackResponse,
  RateParams,
  RateResult,
  RatingSubject,
  ExperimentConfig,
  Variation,
} from "@echoessh/sdk";
```

## Development

```bash
bun install
bun run typecheck   # tsc, sources and tests
bun run test        # Vitest
bun run build       # tsup → dist/
```

`test/fixtures/bucketing-vectors.json` is a verbatim copy of the shared vectors in echoes-v2 (`docs/bucketing-vectors.json`); the server tests against the same file.

## Examples

### Next.js App Router

```tsx
// app/providers.tsx
"use client";

import { EchoesProvider } from "@echoessh/sdk/react";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <EchoesProvider config={{ apiKey: process.env.NEXT_PUBLIC_ECHOES_API_KEY! }}>
      {children}
    </EchoesProvider>
  );
}
```

### Server-Side (Node.js)

```typescript
import { Echoes } from "@echoessh/sdk";

const echoes = new Echoes({
  apiKey: process.env.ECHOES_API_KEY!,
});

// In your API route or server action
export async function submitFeedback(formData: FormData) {
  await echoes.send({
    category: formData.get("category") as any,
    message: formData.get("message") as string,
    userIdentifier: getCurrentUser()?.email,
  });
}
```

### Custom Feedback Button

```tsx
import { useEchoes } from "@echoessh/sdk/react";
import { useState } from "react";

function QuickFeedbackButton() {
  const echoes = useEchoes();
  const [isOpen, setIsOpen] = useState(false);

  const handleQuickFeedback = async (type: "👍" | "👎") => {
    await echoes.send({
      category: type === "👍" ? "praise" : "bug",
      message: `Quick feedback: ${type}`,
      metadata: { quick: true },
    });
    setIsOpen(false);
  };

  return (
    <div>
      <button onClick={() => setIsOpen(!isOpen)}>Feedback</button>
      {isOpen && (
        <div>
          <button onClick={() => handleQuickFeedback("👍")}>👍</button>
          <button onClick={() => handleQuickFeedback("👎")}>👎</button>
        </div>
      )}
    </div>
  );
}
```

## License

MIT
