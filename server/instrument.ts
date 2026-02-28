import * as Sentry from "@sentry/node";

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || "development",
    // Personal project with low traffic — 100% sampling is fine
    tracesSampleRate: 1.0,
    // Sparkle uses Zod extensively — capture structured validation errors
    integrations: [Sentry.zodErrorsIntegration()],
    // Do not send PII (user IPs, etc.)
    sendDefaultPii: false,
  });
}
