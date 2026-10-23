import { describe, expect, it } from "vitest";
import { demoAccessToken } from "@/server/auth";
import { ConfigError, demoAccessCode, getDataMode } from "@/server/env";

const env = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv;
const SUPABASE = { NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" };

describe("data mode", () => {
  it("never falls back to the demo on a production server", () => {
    expect(() => getDataMode(env({ NODE_ENV: "production" }))).toThrow(ConfigError);
    // Even with Supabase variables present, production needs the mode spelled out.
    expect(() => getDataMode(env({ NODE_ENV: "production", ...SUPABASE }))).toThrow(/NEXORA_DATA_MODE is not set/);
  });

  it("accepts an explicit mode in production", () => {
    expect(getDataMode(env({ NODE_ENV: "production", NEXORA_DATA_MODE: "supabase", ...SUPABASE }))).toBe("supabase");
    expect(getDataMode(env({ NODE_ENV: "production", NEXORA_DATA_MODE: "demo" }))).toBe("demo");
  });

  it("infers the mode during the build and in development", () => {
    expect(getDataMode(env({ NODE_ENV: "production", NEXT_PHASE: "phase-production-build" }))).toBe("demo");
    expect(getDataMode(env({ NODE_ENV: "development", ...SUPABASE }))).toBe("supabase");
    expect(getDataMode(env({ NODE_ENV: "development" }))).toBe("demo");
  });

  it("rejects supabase mode without its variables and unknown modes", () => {
    expect(() => getDataMode(env({ NEXORA_DATA_MODE: "supabase" }))).toThrow(ConfigError);
    expect(() => getDataMode(env({ NEXORA_DATA_MODE: "prod" }))).toThrow(/Unknown NEXORA_DATA_MODE/);
  });
});

describe("demo access code", () => {
  it("is optional, must be long enough, and its cookie value changes with the code", () => {
    expect(demoAccessCode(env({}))).toBeNull();
    expect(demoAccessCode(env({ NEXORA_DEMO_ACCESS_CODE: "  " }))).toBeNull();
    expect(() => demoAccessCode(env({ NEXORA_DEMO_ACCESS_CODE: "short" }))).toThrow(ConfigError);
    expect(demoAccessCode(env({ NEXORA_DEMO_ACCESS_CODE: " client-demo-2026 " }))).toBe("client-demo-2026");
    expect(demoAccessToken("client-demo-2026")).not.toBe(demoAccessToken("client-demo-2027"));
    expect(demoAccessToken("client-demo-2026")).not.toContain("client-demo-2026");
  });
});
