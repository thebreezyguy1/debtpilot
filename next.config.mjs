/** @type {import('next').NextConfig} */
const nextConfig = {
  // Lets a production build run beside `next dev` (NEXT_DIST_DIR=.next-build npm run build).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // This folder is the project root, even if other lockfiles exist higher up.
  outputFileTracingRoot: import.meta.dirname,
};

export default nextConfig;
