import { Hono } from "hono";
import { ZodError } from "zod";
import { sqlite } from "../db/index.js";
import { getSetting } from "../lib/settings.js";
import { hashPin, verifyPin } from "../lib/pin.js";
import { createSession, destroySession } from "../lib/private-session.js";
import { setupPinSchema, unlockSchema, changePinSchema } from "../schemas/private.js";

const privateRouter = new Hono();

// GET /status — Check if PIN is configured
privateRouter.get("/status", (c) => {
  const hash = getSetting(sqlite, "private_pin_hash");
  return c.json({ configured: !!hash });
});

// POST /setup — First-time PIN setup
privateRouter.post("/setup", async (c) => {
  try {
    const body = await c.req.json();
    const { pin } = setupPinSchema.parse(body);

    const existing = getSetting(sqlite, "private_pin_hash");
    if (existing) {
      return c.json({ error: "PIN already configured" }, 409);
    }

    const hash = await hashPin(pin);
    sqlite.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run("private_pin_hash", hash);

    return c.json({ success: true });
  } catch (e) {
    if (e instanceof ZodError) {
      return c.json({ error: e.issues[0]?.message ?? "Validation error" }, 400);
    }
    throw e;
  }
});

// POST /unlock — Verify PIN, return session token
privateRouter.post("/unlock", async (c) => {
  try {
    const body = await c.req.json();
    const { pin } = unlockSchema.parse(body);

    const hash = getSetting(sqlite, "private_pin_hash");
    if (!hash) {
      return c.json({ error: "PIN not configured" }, 404);
    }

    const valid = await verifyPin(pin, hash);
    if (!valid) {
      return c.json({ error: "PIN 錯誤" }, 401);
    }

    const token = createSession();
    return c.json({ token });
  } catch (e) {
    if (e instanceof ZodError) {
      return c.json({ error: e.issues[0]?.message ?? "Validation error" }, 400);
    }
    throw e;
  }
});

// POST /lock — Invalidate session token (requires privateTokenMiddleware)
privateRouter.post("/lock", (c) => {
  const token = c.req.header("X-Private-Token");
  if (token) {
    destroySession(token);
  }
  return c.json({ success: true });
});

// PATCH /pin — Change PIN (requires privateTokenMiddleware)
privateRouter.patch("/pin", async (c) => {
  try {
    const body = await c.req.json();
    const { old_pin, new_pin } = changePinSchema.parse(body);

    const hash = getSetting(sqlite, "private_pin_hash");
    if (!hash) {
      return c.json({ error: "PIN not configured" }, 404);
    }

    const valid = await verifyPin(old_pin, hash);
    if (!valid) {
      return c.json({ error: "PIN 錯誤" }, 401);
    }

    const newHash = await hashPin(new_pin);
    sqlite
      .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
      .run("private_pin_hash", newHash);

    return c.json({ success: true });
  } catch (e) {
    if (e instanceof ZodError) {
      return c.json({ error: e.issues[0]?.message ?? "Validation error" }, 400);
    }
    throw e;
  }
});

export { privateRouter };
