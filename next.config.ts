import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */

  // Intentionally double-invokes the components' renderings and effects to help find bugs, memory leaks,
  // and deprecated API usage. ("safety first" setting)
  reactStrictMode: true,    // activates a special development-only mode in React

  // Rewrites act as a proxy, masking the actual destination of a request.
  // This is an asynchronous function that returns a list of URL mapping rules.
  async rewrites() {
    return [
      {
        // The Trigger: This tells Next.js to watch for any incoming request that starts with /v1/.
        // The Wildcard: :path* is a "catch-all" parameter. For example, 
        // if you visit /v1/users/login, the :path*portion becomes users/login.
        source: '/v1/:path*',

        // This tells the NextJS to mask the request. Instead of the browser looking for these files 
        // inside the NextJS project, the server fetches the data from the backend running port 7000
        destination: 'http://localhost:7000/v1/:path*'
      }
    ]
  },
  allowedDevOrigins: [
    'localhost',
    '192.168.1.4'
  ],

  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'pub-28c60659435842bf9c90cfbba6b4b5f2.r2.dev',
        port: '',
        pathname: '/**',
      },
    ],
  },
};

export default nextConfig;
