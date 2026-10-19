/** Small deterministic PRNG (mulberry32) so the seed produces identical data on every run. */
export type Rng = ReturnType<typeof createRng>;

export function createRng(seed: number) {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    int(min: number, max: number): number {
      return Math.floor(next() * (max - min + 1)) + min;
    },
    float(min: number, max: number): number {
      return next() * (max - min) + min;
    },
    chance(probability: number): boolean {
      return next() < probability;
    },
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new Error("pick() on empty list");
      return items[Math.floor(next() * items.length)]!;
    },
    weighted<T>(items: ReadonlyArray<readonly [T, number]>): T {
      const total = items.reduce((sum, [, w]) => sum + w, 0);
      let roll = next() * total;
      for (const [item, weight] of items) {
        roll -= weight;
        if (roll < 0) return item;
      }
      return items[items.length - 1]![0];
    },
    shuffle<T>(items: readonly T[]): T[] {
      const copy = [...items];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [copy[i], copy[j]] = [copy[j]!, copy[i]!];
      }
      return copy;
    },
    /** RFC 4122 version-4 shaped UUID from the PRNG stream. */
    uuid(): string {
      const hex: string[] = [];
      for (let i = 0; i < 16; i++) hex.push(Math.floor(next() * 256).toString(16).padStart(2, "0"));
      hex[6] = ((parseInt(hex[6]!, 16) & 0x0f) | 0x40).toString(16).padStart(2, "0");
      hex[8] = ((parseInt(hex[8]!, 16) & 0x3f) | 0x80).toString(16).padStart(2, "0");
      const h = hex.join("");
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    },
  };
}
