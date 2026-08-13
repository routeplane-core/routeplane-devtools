import { createRequire } from 'node:module';

interface PackageMetadata {
  version?: unknown;
}

const require = createRequire(import.meta.url);
const metadata = require('../package.json') as PackageMetadata;

if (typeof metadata.version !== 'string' || metadata.version.length === 0) {
  throw new Error('CLI package version is missing');
}

/** The published `@routeplane/cli` package version. */
export const CLI_VERSION = metadata.version;
