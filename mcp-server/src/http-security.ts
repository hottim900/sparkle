import express from "express";

export const MAX_REQUEST_BODY_BYTES = 1024 * 1024;
export const MAX_TOOL_INPUT_ELEMENTS = 10_000;

export function createRequestParsers(): express.RequestHandler[] {
  // Reject compressed input before creating a zlib/Brotli decoder. Tool calls
  // use JSON; OAuth forms only need a small, flat set of fields.
  return [
    express.json({ limit: MAX_REQUEST_BODY_BYTES, inflate: false }),
    express.urlencoded({ extended: false, limit: "16kb", parameterLimit: 32, inflate: false }),
  ];
}
