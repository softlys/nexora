import tokens from "../../../../../tokens/tokens.json";

/** The source tokens file (W3C design tokens format), as used to build src/styles/tokens.css. */
export function GET() {
  return new Response(JSON.stringify(tokens, null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": 'attachment; filename="nexora-tokens.json"' },
  });
}
