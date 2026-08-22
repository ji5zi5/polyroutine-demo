/** @type {import("next").NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async redirects() {
    return [{ destination: "/demo", permanent: false, source: "/" }]
  },
}

export default nextConfig
