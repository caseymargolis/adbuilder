/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: { bodySizeLimit: "5mb" },
    // These are optional peer deps — loaded dynamically only when enabled
    // via DATABASE_URL / USE_HEADLESS_SITE_READER. Keep them out of the
    // webpack graph so `next build` doesn't fail when they aren't installed.
    serverComponentsExternalPackages: ["pg", "playwright", "playwright-core"],
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = [
        ...(config.externals || []),
        { pg: "commonjs pg", playwright: "commonjs playwright" },
      ];
    }
    return config;
  },
};

module.exports = nextConfig;
