import { describe, it, expect } from "vitest";
import { hashPin, verifyPin } from "../pin";

describe("PIN hashing", () => {
  it("hashes a PIN and returns scrypt:salt:hash format", async () => {
    const hash = await hashPin("123456");
    expect(hash).toMatch(/^scrypt:[a-f0-9]+:[a-f0-9]+$/);
  });

  it("verifies correct PIN", async () => {
    const hash = await hashPin("123456");
    expect(await verifyPin("123456", hash)).toBe(true);
  });

  it("rejects wrong PIN", async () => {
    const hash = await hashPin("123456");
    expect(await verifyPin("654321", hash)).toBe(false);
  });

  it("produces different hashes for same PIN (unique salt)", async () => {
    const h1 = await hashPin("123456");
    const h2 = await hashPin("123456");
    expect(h1).not.toBe(h2);
  });

  it("rejects malformed hash string", async () => {
    expect(await verifyPin("123456", "not-a-hash")).toBe(false);
  });
});
