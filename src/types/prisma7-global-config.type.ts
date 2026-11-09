import { VSLogLevel } from "vsrepo";
import { PrismaProvider } from "./prisma-provider.type.js";

/**
 * Defaults applied to every adapter instance, set through
 * `VSRepoPrisma7Adapter.setGlobalConfig`. A field set in an adapter's own
 * config wins over the global one.
 *
 * @publicApi
 */
export type Prisma7GlobalConfig = {
    /** Default `provider` (see `Prisma7AdapterConfig.provider`). */
    provider?: PrismaProvider;
    /** Default `logLevel` (see `Prisma7AdapterConfig.logLevel`). */
    logLevel?: VSLogLevel;
    /** Default `allowOmitPk` (see `Prisma7AdapterConfig.allowOmitPk`). @default false */
    allowOmitPk?: boolean;
};
