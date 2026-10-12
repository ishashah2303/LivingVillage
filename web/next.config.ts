import type { NextConfig } from 'next';

// `STATIC_EXPORT=1 npm run build` produces a static site in out/ (e.g. for GitHub Pages).
// Set BASE_PATH=/repo-name when hosting under a sub-path.
const isExport = process.env.STATIC_EXPORT === '1';

const nextConfig: NextConfig = {
  // StrictMode double-mounts drei's <Html> labels (each is its own React root), which React 19
  // reports as "synchronously unmount a root" errors in dev. The simulation itself is StrictMode-safe.
  reactStrictMode: false,
  // Keep the dev-mode "N" bubble out of live demos and screenshots.
  devIndicators: false,
  ...(isExport
    ? { output: 'export', basePath: process.env.BASE_PATH ?? '', images: { unoptimized: true } }
    : {}),
};

export default nextConfig;
