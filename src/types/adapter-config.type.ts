import type { VSLogLevel } from "vsrepo";
import { AdapterRelations } from "./adapter-relations.type.js";
import { Prisma7ClientLike } from "./prisma7-client-like.type.js";
import { PrismaClientModels } from "./prisma-client-models.type.js";
import { PrismaProvider } from "./prisma-provider.type.js";

/**
 * Configuration accepted by `VSRepoPrisma7Adapter`'s constructor, as the
 * second parameter.
 *
 * @publicApi
 */
export interface Prisma7AdapterConfig<T = any, K extends Prisma7ClientLike = Prisma7ClientLike> {
    /** Name of the Prisma Client model/delegate (e.g. `"user"`, as in `prisma.user`). */
    modelName: [PrismaClientModels<K>] extends [never] ? string : PrismaClientModels<K>;
    /** Name of the entity's primary key field (e.g. `"id"`). */
    pkName: keyof T;
    /**
     * The entity's relation configuration, needed by the `create`/`update`
     * parsers to correctly resolve relation fields (see `Relation`/`AdapterRelations`).
     * Optional: without it, relation fields are passed through to Prisma as-is (raw).
     */
    relations?: AdapterRelations<T>;
    /**
     * The Prisma schema provider, used to resolve the raw-query placeholder
     * syntax (`getPlaceholder()`). When omitted, the adapter detects it from
     * the generated Prisma Client (`_engineConfig.activeProvider`, falling
     * back to the driver adapter's `provider`). Provide it manually to
     * override detection.
     */
    provider?: PrismaProvider;
    /** Minimum log level for the adapter's internal `VSLogger`. @default VSLogLevel.WARN */
    logLevel?: VSLogLevel;
}
