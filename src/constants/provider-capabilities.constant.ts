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

/**
 * Providers that support Prisma's `skipDuplicates` (`INSERT ... ON CONFLICT DO NOTHING`
 * or equivalent), which is what `ignoreConflicts` is translated to on `createMany` and
 * `createManyReturning`.
 */
export const SKIP_DUPLICATES_PROVIDERS: ReadonlySet<PrismaProvider> = new Set<PrismaProvider>([
    "postgresql",
    "mysql",
    "cockroachdb",
]);
