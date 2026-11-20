import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    agentFeedback: true,
    agentUpgrade: "security",
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // Configuration moved into the Settings area. Every previous URL keeps
  // working so bookmarks, docs, and integrations never hit a 404.
  async redirects() {
    return [
      {
        source: "/admin/organization",
        destination: "/settings/general",
        permanent: false,
      },
      {
        source: "/admin/roles",
        destination: "/settings/roles",
        permanent: false,
      },
      {
        source: "/admin/leave/types",
        destination: "/settings/leave",
        permanent: false,
      },
      {
        source: "/admin/leave/holidays/settings",
        destination: "/settings/leave/holidays",
        permanent: false,
      },
      {
        source: "/admin/monitoring",
        destination: "/settings/monitoring",
        permanent: false,
      },
      {
        source: "/admin/activity",
        destination: "/settings/monitoring/tracking",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
