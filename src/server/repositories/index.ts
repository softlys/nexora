import "server-only";
import { getDataMode } from "@/server/env";
import { createDemoRepositories } from "./demo";
import { createSupabaseRepositories } from "./supabase";
import type { Repositories } from "./types";

let demo: Repositories | null = null;

/** Returns the adapter selected by NEXORA_DATA_MODE (demo when Supabase is not configured). */
export function getRepositories(): Repositories {
  if (getDataMode() === "supabase") return createSupabaseRepositories();
  demo ??= createDemoRepositories();
  return demo;
}

export type { Repositories, RepoContext } from "./types";
export { DomainError } from "./types";
