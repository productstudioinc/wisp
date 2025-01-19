import { withContentCollections } from "@content-collections/next";
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
}

export default withContentCollections(nextConfig);