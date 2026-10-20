import { buildOpenApi } from "@/domain/api/openapi";

/** OpenAPI 3.1 document for /api/v1, generated from the same Zod schemas the routes validate with. */
export function GET() {
  return Response.json(buildOpenApi(), { headers: { "Cache-Control": "public, max-age=300" } });
}
