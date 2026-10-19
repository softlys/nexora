import { rmSync } from "node:fs";

/** Every e2e run starts from a fresh seeded demo dataset. */
export default function globalSetup() {
  rmSync(".data/e2e-demo.json", { force: true });
}
