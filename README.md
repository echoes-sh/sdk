# @echoessh/sdk

Official SDK for [Echoes](https://echoes.sh) - Centralized feedback platform for developers managing multiple SaaS products.

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

### React Components

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

### React Hooks

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

## TypeScript Support

The SDK is written in TypeScript and includes full type definitions:

```typescript
import type {
  EchoesConfig,
  FeedbackCategory,
  SendFeedbackParams,
  FeedbackResponse,
} from "@echoessh/sdk";
```

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
