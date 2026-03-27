/** Hono environment type shared across app and sub-routers */
export type AppEnv = {
  Variables: {
    cspNonce: string;
  };
};
