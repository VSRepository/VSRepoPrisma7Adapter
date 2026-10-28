import { PrismaProvider } from "../types/prisma-provider.type.js";

/**
 * Providers where Prisma accepts the `mode: "insensitive"` filter, which is
 * what `ignoreCase` is translated to (see the README's provider support table).
 */
export const INSENSITIVE_MODE_PROVIDERS: ReadonlySet<PrismaProvider> = new Set<PrismaProvider>([
    "postgresql",
    "cockroachdb",
]);

/**
 * Providers that expose `createManyAndReturn` and `updateManyAndReturn`, which
 * `createManyReturning` and `updateManyReturning` are built on.
 */
export const RETURNING_MANY_PROVIDERS: ReadonlySet<PrismaProvider> = new Set<PrismaProvider>([
    "postgresql",
    "cockroachdb",
    "sqlite",
]);
