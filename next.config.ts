import { withContentCollections } from '@content-collections/next'
import type { NextConfig } from 'next'

const nextConfig = {
	reactStrictMode: true,
} satisfies Partial<NextConfig>

export default withContentCollections(nextConfig)
