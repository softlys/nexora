/** ISO 3166-1 alpha-2 codes offered in country pickers. Labels come from Intl. */
export const COUNTRY_CODES = [
  "AT", "AU", "BE", "BR", "CA", "CH", "CN", "CZ", "DE", "DK", "ES", "FI", "FR", "GB", "GR", "HU", "IE", "IN", "IT", "JP",
  "KR", "MX", "NL", "NO", "NZ", "PL", "PT", "RO", "SE", "SG", "SK", "TR", "US", "ZA",
] as const;

const names = new Intl.DisplayNames(["en"], { type: "region" });

export function countryName(code: string): string {
  try {
    return names.of(code) ?? code;
  } catch {
    return code;
  }
}

export const COUNTRY_OPTIONS = COUNTRY_CODES.map((code) => ({ value: code, label: countryName(code) })).sort((a, b) => a.label.localeCompare(b.label));
