const nextConfig = {
  swcMinify: false,
  experimental: {
    workerThreads: false,
    cpus: 1,
    // Treat these as external runtime requires from API routes instead of
    // bundling them. Specifically `mermaid` is ESM-only and breaks Next's
    // CommonJS require if bundled into the server chunk; jsdom and pdf2json
    // pull heavy native-ish deps that don't play well with webpack bundling.
    serverComponentsExternalPackages: [
      "jsdom",
      "pdf2json",
    ],
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
