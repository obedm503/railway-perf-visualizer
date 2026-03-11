import { log } from "evlog";
import pino from "pino";
import { setup } from "rivetkit";
import { httpLogCollector } from "./http-log-collector";
import { env } from "../env";
import { createClient } from "rivetkit/client";

// pino level numbers to names
const PINO_LEVELS: Record<number, string> = {
  10: "trace",
  20: "debug",
  30: "info",
  40: "warn",
  50: "error",
  60: "fatal",
};

function forwardToEvlog(o: Record<string, unknown>) {
  const { time, pid, hostname, level, ...rest } = o;
  const event: Record<string, unknown> = { source: "rivetkit", ...rest };

  const levelName = PINO_LEVELS[level as number] ?? "info";
  switch (levelName) {
    case "fatal":
    case "error":
      log.error(event);
      break;
    case "warn":
      log.warn(event);
      break;
    case "debug":
      log.debug(event);
      break;
    default:
      log.info(event);
      break;
  }
}

const evlogDestination: pino.DestinationStream = {
  write(msg: string) {
    try {
      const parsed = JSON.parse(msg);
      forwardToEvlog(parsed);
    } catch {
      log.info({ msg: msg.trimEnd(), source: "rivetkit" });
    }
  },
};

const baseLogger = pino({ level: "debug" }, evlogDestination);

const RIVET_PORT = env.PORT + 1;

const registry = setup({
  use: { httpLogCollector },
  logging: { baseLogger },
  storagePath: env.RIVET_STORAGE_PATH,
  managerHost: "::",
  managerPort: RIVET_PORT,
});

registry.startRunner();

export const rivetClient = createClient<typeof registry>(
  `http://localhost:${RIVET_PORT}`,
);
