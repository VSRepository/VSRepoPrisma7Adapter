import { PrismaProvider } from "../types/prisma-provider.type.js";

export const PRISMA_PROVIDERS = ["postgresql", "cockroachdb", "mysql", "sqlite", "sqlserver"];

export const PrismaProvidersSet = new Set(PRISMA_PROVIDERS);

type PrismaDriverAdapterProvider = "postgres" | "mysql" | "sqlite" | "sqlserver";

const ADAPTER_PROVIDER_TO_PRISMA_PROVIDER: Record<PrismaDriverAdapterProvider, PrismaProvider> = {
    postgres: "postgresql",
    mysql: "mysql",
    sqlite: "sqlite",
    sqlserver: "sqlserver",
};

function isPrismaProvider(value: unknown): value is PrismaProvider {
    return PrismaProvidersSet.has(value as PrismaProvider);
}

/**
 * Resolves the Prisma datasource provider of a Prisma Client, in the following
 * precedence order:
 *
 * 1. `override` — the `provider` explicitly configured by the user in the
 *    adapter config (wins over everything);
 * 2. `prisma._engineConfig?.activeProvider` — the schema provider baked into
 *    the generated client at compile time (e.g. `"postgresql"` from
 *    `datasource db { provider = "postgresql" }`). This is what Prisma itself
 *    uses internally to select the query compiler and validate the driver
 *    adapter, so it is the most reliable signal available — even though it is
 *    a private/underscored API, with no semver guarantee;
 * 3. `prisma._engineConfig?.adapter?.provider` — the runtime driver adapter's
 *    declared provider (e.g. `"postgres"` for `PrismaPg`), as a secondary
 *    source when `activeProvider` isn't present.
 *
 * Returns `undefined` when none of the sources yield a known provider — the
 * caller decides what to do with that (e.g. `getPlaceholder` throws a
 * `NOT_SUPPORTED` error only when it actually needs to know the provider).
 */
export function resolveProvider(prisma: unknown, override?: PrismaProvider): PrismaProvider | undefined {
    if (override !== undefined) {
        return override;
    }

    const engineConfig = (
        prisma as {
            _engineConfig?: { activeProvider?: unknown; adapter?: { provider?: unknown } };
        }
    )._engineConfig;

    if (isPrismaProvider(engineConfig?.activeProvider)) {
        return engineConfig.activeProvider;
    }

    const adapterProvider = engineConfig?.adapter?.provider;
    if (typeof adapterProvider === "string" && adapterProvider in ADAPTER_PROVIDER_TO_PRISMA_PROVIDER) {
        return ADAPTER_PROVIDER_TO_PRISMA_PROVIDER[adapterProvider as keyof typeof ADAPTER_PROVIDER_TO_PRISMA_PROVIDER];
    }

    return undefined;
}
