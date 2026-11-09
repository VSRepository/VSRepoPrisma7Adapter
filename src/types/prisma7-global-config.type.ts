import { VSLogLevel } from "vsrepo";
import { PrismaProvider } from "./prisma-provider.type.js";

/**
 * Defaults applied to adapter instances created after
 * `VSRepoPrisma7Adapter.setGlobalConfig` is called. A field set in an
 * adapter's own config wins over the global one.
 *
 * @publicApi
 */
export type Prisma7GlobalConfig = {
    /**
     * The default Prisma schema provider, used to resolve the raw-query
     * placeholder syntax (`getPlaceholder()`). When omitted, each adapter
     * detects it from the generated Prisma Client (`_engineConfig.activeProvider`,
     * falling back to the driver adapter's `provider`). An adapter-level
     * `provider` overrides this value.
     */
    provider?: PrismaProvider;
    /**
     * The default minimum log level for each adapter's internal `VSLogger`.
     * An adapter-level `logLevel` overrides this value.
     *
     * @default VSLogLevel.WARN
     */
    logLevel?: VSLogLevel;
    /**
     * Whether adapters may drop the primary key from a write payload when it
     * cannot be sent. This happens when the payload has a relation that holds
     * its foreign key in the same entity (`fkHere`, e.g. `Address.user`):
     * Prisma does not accept the primary key in that kind of nested write.
     * When disabled, such a payload throws `INVALID_DATA`.
     *
     * **Careful:** when enabled, `save` with a primary key that does not exist
     * yet creates the record with a database-generated key, not the one sent.
     * Only enable this when the database, rather than the application,
     * generates the ids. An adapter-level `allowOmitPk` overrides this value.
     *
     * @default false
     */
    allowOmitPk?: boolean;
};
