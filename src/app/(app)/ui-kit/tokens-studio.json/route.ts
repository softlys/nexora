import tokens from "../../../../../tokens/tokens.json";
import { toTokensStudio } from "@/domain/design/tokens-studio";

/** Design tokens in Tokens Studio for Figma format (sets core, light, dark and two themes). */
export function GET() {
  return new Response(JSON.stringify(toTokensStudio(tokens as Record<string, unknown>), null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": 'attachment; filename="nexora-tokens-studio.json"' },
  });
}
