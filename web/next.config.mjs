/** @type {import('next').NextConfig} */
const nextConfig = {
  devIndicators: false,
  experimental: { serverActions: { bodySizeLimit: "25mb" } }, poweredByHeader: false };
export default nextConfig;
