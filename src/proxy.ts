import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Runs before every page and API request:
 * - attaches an x-request-id used in audit logs and safe error messages
 * - in Supabase mode, refreshes the auth session cookie and sends signed-out users to /login
 * Authorization is NOT decided here; every page and action re-checks the session and can().
 */
export async function proxy(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", requestId);

  let response = NextResponse.next({ request: { headers: requestHeaders } });

  // Read through a variable so the values come from the runtime environment, not the build (see src/server/env.ts).
  const env = process.env;
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const mode = env.NEXORA_DATA_MODE ?? (url && anonKey ? "supabase" : "demo");

  if (mode === "supabase" && url && anonKey) {
    const supabase = createServerClient(url, anonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request: { headers: requestHeaders } });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    });
    const { data } = await supabase.auth.getUser();
    const path = request.nextUrl.pathname;
    const isPublic = path === "/login" || path === "/manifest.webmanifest" || path.startsWith("/api/");
    if (!data.user && !isPublic) {
      const login = request.nextUrl.clone();
      login.pathname = "/login";
      login.search = "";
      return NextResponse.redirect(login);
    }
  }

  response.headers.set("x-request-id", requestId);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|ico)$).*)"],
};
