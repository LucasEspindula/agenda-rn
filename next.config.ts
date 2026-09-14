import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
  poweredByHeader: false,
  images: { unoptimized: true },
  async headers() { return [{source:'/:path*',headers:[
    {key:'Strict-Transport-Security',value:'max-age=31536000; includeSubDomains'},
    {key:'X-Content-Type-Options',value:'nosniff'},
    {key:'X-Frame-Options',value:'DENY'},
    {key:'Referrer-Policy',value:'no-referrer'},
    {key:'Permissions-Policy',value:'camera=(), microphone=(), geolocation=()'},
  ]}]; },
};
export default nextConfig;
