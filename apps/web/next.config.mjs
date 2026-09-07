/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The web client is served by Cloudflare Pages; the API is a separate Worker.
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8787",
  },
};

export default nextConfig;
