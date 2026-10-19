export type Params = Record<string, string | string[] | undefined>;

/** Builds `path?query` from current params plus a patch. Empty/undefined values are removed. */
export function hrefWith(path: string, params: Params, patch: Record<string, string | number | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    const value = Array.isArray(v) ? v[0] : v;
    if (value !== undefined && value !== "") sp.set(k, value);
  }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === null || v === "") sp.delete(k);
    else sp.set(k, String(v));
  }
  const qs = sp.toString();
  return qs ? `${path}?${qs}` : path;
}
