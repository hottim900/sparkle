import { z } from "zod";

const pinSchema = z.string().regex(/^\d{6,12}$/, "PIN must be 6-12 digits");

export const setupPinSchema = z.object({
  pin: pinSchema,
});

export const unlockSchema = z.object({
  pin: pinSchema,
});

export const changePinSchema = z.object({
  old_pin: pinSchema,
  new_pin: pinSchema,
});
