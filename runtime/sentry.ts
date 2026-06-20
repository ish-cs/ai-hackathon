import * as Sentry from "@sentry/node";

let enabled = false;

export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    console.log("[sentry] no SENTRY_DSN — failure capture disabled");
    return;
  }
  Sentry.init({ dsn, tracesSampleRate: 1.0 });
  enabled = true;
  console.log("[sentry] initialized");
}

/** Step failures are the entire point of the product — capture them. */
export function captureFailure(message: string, context: Record<string, unknown>): void {
  console.warn("[failure]", message, context);
  if (!enabled) return;
  Sentry.captureMessage(message, { level: "warning", extra: context });
}
