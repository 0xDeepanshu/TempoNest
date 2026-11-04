import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "WorkZen",
    short_name: "WorkZen",
    description:
      "Attendance, time tracking, and team reporting for organizations and their employees.",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f5f3",
    theme_color: "#0d0d0d",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/favicon.ico",
        sizes: "any",
        type: "image/x-icon",
      },
    ],
  };
}
