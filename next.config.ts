import type { NextConfig } from "next";

// 운영에서는 Caddy가 /api/v1 경로를 auth · backend로 나눠 보낸다(설계서 7.1.4).
// 로컬 개발에서는 Caddy가 없으니 Next.js가 같은 규칙으로 대신 넘겨 준다.
// 브라우저 입장에서는 항상 같은 출처(/api/v1)라서 쿠키 · Origin 검사가 운영과 같게 동작한다.
const backend = process.env.API_PROXY_TARGET;
const auth = process.env.AUTH_PROXY_TARGET ?? backend;

const nextConfig: NextConfig = {
  output: "standalone",
  reactCompiler: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async redirects() {
    return [
      // 백엔드 재설정 메일 링크(/reset-password#token=…)를 재설정 화면으로. 브라우저가 #token은 그대로 붙여 준다
      { source: "/reset-password", destination: "/password/reset", permanent: false },
    ];
  },
  async rewrites() {
    if (!backend || !auth) return [];
    // 위에서부터 먼저 맞는 규칙이 적용된다. auth 경로를 backend 전체 규칙보다 먼저 둔다
    return [
      { source: "/api/v1/users", destination: `${auth}/api/v1/users` },
      { source: "/api/v1/auth/:path*", destination: `${auth}/api/v1/auth/:path*` },
      { source: "/api/v1/me", destination: `${auth}/api/v1/me` },
      { source: "/api/v1/:path*", destination: `${backend}/api/v1/:path*` },
    ];
  },
};

export default nextConfig;
