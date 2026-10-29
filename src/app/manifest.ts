import type { MetadataRoute } from "next";
import { tr } from "@/lib/i18n";

/** Lets people install NEXORA on a phone or desktop as an app (no app store needed). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "NEXORA",
    short_name: "NEXORA",
    description: tr("B2B operations platform: CRM, sales pipeline, orders and workflow automation."),
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#5835d8",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
