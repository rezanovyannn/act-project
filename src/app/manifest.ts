import type { MetadataRoute } from "next"

/** Web app manifest agar aplikasi dapat dipasang di desktop & HP (ROADMAP Fase 9). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Pembukuan",
    short_name: "Pembukuan",
    description: "Akuntansi pribadi multi-workspace berbasis akrual (SAK EMKM)",
    lang: "id",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#fbfbf9",
    theme_color: "#fbfbf9",
    categories: ["finance", "business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  }
}
