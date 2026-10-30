import { AdapterErrorCode, VSRepoAdapterError } from "vsrepo";
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

function isPrismaProvider(value: string): value is PrismaProvider {
    return PrismaProvidersSet.has(value);
}

export function resolveProvider(prisma: unknown, override?: PrismaProvider): PrismaProvider {
    if (override !== undefined) {
        return override;
    }

    const engineConfig = (
        prisma as {
            _engineConfig?: { activeProvider?: unknown; adapter?: { provider?: unknown } };
        }
    )._engineConfig;

    if (typeof engineConfig?.activeProvider === "string" && isPrismaProvider(engineConfig.activeProvider)) {
        return engineConfig.activeProvider;
    }

    const adapterProvider = engineConfig?.adapter?.provider;
    if (typeof adapterProvider === "string" && adapterProvider in ADAPTER_PROVIDER_TO_PRISMA_PROVIDER) {
        return ADAPTER_PROVIDER_TO_PRISMA_PROVIDER[adapterProvider as keyof typeof ADAPTER_PROVIDER_TO_PRISMA_PROVIDER];
    }

    throw new VSRepoAdapterError(
        `Could not detect the Prisma datasource provider from the provided client. ` +
            `Set the 'provider' option in the adapter config explicitly ` +
            `(one of: ${PRISMA_PROVIDERS.join(", ")}).`,
        AdapterErrorCode.NOT_SUPPORTED,
        null,
    );
}
