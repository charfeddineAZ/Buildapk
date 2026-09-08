/** @type {import('next').NextConfig} */
const API_PROXY_TARGET = process.env.API_PROXY_TARGET; // e.g. http://localhost:8787 (dev) — proxies /api/* same-origin

const nextConfig = {
  reactStrictMode: true,
  // The web client is deployed as a Cloudflare Worker (OpenNext); the API is a
  // separate Worker. NEXT_PUBLIC_API_URL is inlined at build time. When
  // API_PROXY_TARGET is set (local dev / previews) the client talks to the
  // same-origin `/api` prefix and Next proxies it to the API server.
  env: {
    NEXT_PUBLIC_API_URL: API_PROXY_TARGET ? "/api" : process.env.NEXT_PUBLIC_API_URL || "http://localhost:8787",
  },
  async rewrites() {
    return API_PROXY_TARGET ? [{ source: "/api/:path*", destination: `${API_PROXY_TARGET}/:path*` }] : [];
  },
  // Avoid image optimizer (not available on Workers by default).
  images: { unoptimized: true },
};

export default nextConfig;
