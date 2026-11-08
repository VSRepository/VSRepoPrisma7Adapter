import { VSLogLevel } from "vsrepo";
import { PrismaProvider } from "./prisma-provider.type.js";

/**
 * @publicApi
 */
export type Prisma7GlobalConfig = {
    provider?: PrismaProvider;
    logLevel?: VSLogLevel;
    allowOmitPk?: boolean;
};
