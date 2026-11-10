import type { KeysOfType, Primitive, VSLogLevel } from "vsrepo";
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
    /**
     * Name of the entity's primary key field (e.g. `"id"`). It must be a scalar
     * field of the Prisma model.
     */
    pkName: KeysOfType<T, Primitive> & string;
    /**
     * The entity's relation configuration, needed by the `create`/`update`
     * parsers to correctly resolve relation fields (see `Relation`/`AdapterRelations`).
     * Optional: without it, relation fields are left out of every write, since
     * the adapter only writes the scalar fields of the model and the relations
     * configured here.
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
    /**
     * Lets the adapter drop the primary key from a write payload when it can't
     * be sent. That happens when the payload has a relation that holds its
     * foreign key in this same entity (`fkHere`, e.g. `Address.user`): Prisma
     * doesn't accept the primary key in that kind of nested write. When `false`,
     * such a payload throws `INVALID_DATA`.
     *
     * **Careful:** with this on, `save` with a primary key that doesn't exist
     * yet creates the record with a database-generated key, not the one you
     * sent. Only enable it if you really need it and if the database (not your
     * application) generates the ids. Falls back to the global config
     * (`setGlobalConfig`) when omitted.
     *
     * @default false
     */
    allowOmitPk?: boolean;
}
