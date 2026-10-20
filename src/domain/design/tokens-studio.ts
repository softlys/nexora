/**
 * Converts tokens/tokens.json (W3C design tokens: `$value`, `$type`) into the Tokens Studio
 * for Figma JSON format (multi-file "sets" in one document: `value`, `type`, `$themes`,
 * `$metadata`), so the file can be loaded in the Tokens Studio plugin and exported to
 * Figma variables. See docs/figma-design-system.md for the exact steps.
 *
 * Sets: core (primitives, typography, spacing, radius, shadows), light, dark (semantic
 * colors that alias core). Themes "Light" and "Dark" enable core as a source plus one mode.
 */

type DtcgToken = { $type: string; $value: unknown; $description?: string };
type DtcgGroup = { [key: string]: DtcgToken | DtcgGroup | string };
type StudioToken = { value: unknown; type: string; description?: string };
type StudioGroup = { [key: string]: StudioToken | StudioGroup };

const isToken = (v: unknown): v is DtcgToken => typeof v === "object" && v !== null && "$value" in v;

/** Tokens Studio type names for each kind of token, decided by type and path. */
function studioType(dtcgType: string, path: string[]): string {
  if (dtcgType === "color") return "color";
  if (dtcgType === "fontFamily") return "fontFamilies";
  if (dtcgType === "fontWeight") return "fontWeights";
  if (dtcgType === "shadow") return "boxShadow";
  const p = path.join(".");
  if (p.startsWith("font.size")) return "fontSizes";
  if (p.startsWith("font.line-height")) return "lineHeights";
  if (p.startsWith("spacing")) return "spacing";
  if (p.startsWith("radius")) return "borderRadius";
  if (p.startsWith("border.width")) return "borderWidth";
  return dtcgType === "dimension" ? "dimension" : "other";
}

/** Figma has no CSS variables: replace the app's font variables with the font names. */
function fontFamily(value: string): string {
  return value.replace(/var\(--font-geist-sans\)/g, "Geist").replace(/var\(--font-geist-mono\)/g, "Geist Mono").split(",")[0]!.trim();
}

/** "0 1px 2px 0 rgb(16 18 27 / 0.05), …" → Tokens Studio box shadow objects. */
export function parseShadow(css: string): Array<{ x: string; y: string; blur: string; spread: string; color: string; type: "dropShadow" | "innerShadow" }> {
  return css
    .split(/,(?![^(]*\))/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const inset = part.startsWith("inset ");
      const body = inset ? part.slice(6) : part;
      const color = body.match(/(rgba?\([^)]*\)|hsla?\([^)]*\)|#[0-9a-f]{3,8})/i)?.[0] ?? "#000000";
      const [x = "0", y = "0", blur = "0", spread = "0"] = body.replace(color, "").trim().split(/\s+/);
      return { x, y, blur, spread, color, type: inset ? "innerShadow" : "dropShadow" };
    });
}

function convertGroup(group: DtcgGroup, path: string[] = []): StudioGroup {
  const out: StudioGroup = {};
  for (const [key, value] of Object.entries(group)) {
    if (key.startsWith("$")) continue;
    const here = [...path, key];
    if (isToken(value)) {
      const type = studioType(value.$type, here);
      let v = value.$value;
      if (type === "fontFamilies" && typeof v === "string") v = fontFamily(v);
      if (type === "boxShadow" && typeof v === "string") v = parseShadow(v);
      if (value.$type === "cubicBezier" && Array.isArray(v)) v = `cubic-bezier(${v.join(", ")})`;
      out[key] = { value: v, type, ...(value.$description ? { description: value.$description } : {}) };
    } else if (typeof value === "object") {
      out[key] = convertGroup(value as DtcgGroup, here);
    }
  }
  return out;
}

export function toTokensStudio(tokens: Record<string, unknown>) {
  const { semantic, ...core } = tokens as { semantic: { light: DtcgGroup; dark: DtcgGroup } } & Record<string, unknown>;
  return {
    core: convertGroup(core as DtcgGroup),
    light: { color: convertGroup(semantic.light) },
    dark: { color: convertGroup(semantic.dark) },
    $themes: [
      { id: "nexora-light", name: "Light", group: "Mode", selectedTokenSets: { core: "source", light: "enabled" } },
      { id: "nexora-dark", name: "Dark", group: "Mode", selectedTokenSets: { core: "source", dark: "enabled" } },
    ],
    $metadata: { tokenSetOrder: ["core", "light", "dark"] },
  };
}
