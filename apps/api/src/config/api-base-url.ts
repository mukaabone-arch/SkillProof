/**
 * Base URL this API is reachable at from a browser — mirrors WEB_BASE_URL's
 * shape and purpose (see that file's doc comment) but points the other
 * direction. Only consumed by LocalDiskStorageService to build the
 * dev-mode stand-in for a presigned download URL; S3StorageService never
 * touches this, since S3 URLs are already absolute.
 *
 * No trailing slash. Defaults to the local Nest dev server port so
 * `yarn start:dev` produces working links with no .env changes.
 */
export const API_BASE_URL = (process.env.API_BASE_URL ?? 'http://localhost:4000').replace(/\/+$/, '');
