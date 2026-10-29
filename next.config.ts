import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // NEXORA renders per-user, per-role data on every request, so it uses the
  // request-time rendering model instead of Cache Components. See PROGRESS.md.
  poweredByHeader: false,
  // Self-contained server bundle for the Docker image (Vercel ignores it).
  output: "standalone",
  // The dev-only Next.js indicator sits bottom-right, away from the sidebar's sign-out button.
  devIndicators: { position: "bottom-right" },
  // Mail libraries load optional modules at run time; keep them as plain Node packages.
  serverExternalPackages: ["imapflow", "mailparser"],
  experimental: {
    authInterrupts: true,
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    // Website forms (/api/forms/<id>) are made to be embedded in customers' sites in an iframe.
    const embeddable = [...securityHeaders.filter((h) => h.key !== "X-Frame-Options"), { key: "Content-Security-Policy", value: "frame-ancestors *" }];
    return [
      { source: "/:path((?!api/forms/).*)", headers: securityHeaders },
      { source: "/api/forms/:path*", headers: embeddable },
    ];
  },
};

export default nextConfig;
