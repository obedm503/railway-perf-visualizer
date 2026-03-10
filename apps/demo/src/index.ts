import { serve } from "bun";
import type { Context } from "hono";
import { Hono } from "hono";

const failures = [500, 502, 503, 504] as const;
const port = Number(process.env.PORT ?? 3001);

const app = new Hono();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function maybeFailureStatus(): (typeof failures)[number] | null {
  if (Math.random() >= 0.2) {
    return null;
  }

  return failures[randomInt(0, failures.length - 1)];
}

async function respondWithDelay(c: Context, delayMs: number) {
  await sleep(delayMs);

  const failureStatus = maybeFailureStatus();
  if (failureStatus !== null) {
    return c.text(failureStatus.toString(), failureStatus);
  }

  return c.text("ok");
}

app.get("/fast", async (c) => {
  return respondWithDelay(c, 0);
});

app.get("/slow", async (c) => {
  return respondWithDelay(c, 10_000);
});

app.get("/random", async (c) => {
  return respondWithDelay(c, randomInt(0, 20_000));
});

serve({
  port,
  fetch: app.fetch,
});

console.log(`demo listening on http://localhost:${port}`);
