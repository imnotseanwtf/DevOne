import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Sign-in arguments and OAuth callback queries can contain credentials.
  logging: {
    serverFunctions: false,
    incomingRequests: { ignore: [/\/api\/ai\/oauth\/[^/]+\/callback/, /^\/callback(?:\?|$)/] }
  },
  output: process.env.BUILD_STANDALONE === 'true' ? 'standalone' : undefined,
  // ssh2 loads optional native crypto bindings at runtime; bundling breaks them.
  serverExternalPackages: ['ssh2', 'mongodb', 'ioredis'],
  experimental: {
    // Drawings save their whole Excalidraw scene (pasted images included) through a
    // server action; 1 MB is the default. Vercel caps request bodies at 4.5 MB.
    serverActions: { bodySizeLimit: '5mb' }
  },
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production'
  }
};

export default nextConfig;
