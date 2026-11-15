import { Prisma7ClientLike } from "./prisma7-client-like.type.js";
import { TxParam } from "./tx-param.type.js";

/**
 * Helper used to type a `VSRepository`'s `OrmTypes` generic when using
 * `VSRepoPrisma7Adapter`, tying the repository's `getDbClient()`/`transaction()`
 * return types to the real Prisma Client and transaction client types.
 *
 * @example
 * ```typescript
 * type MyOrmTypes = Prisma7OrmTypes<PrismaClient>;
 *
 * class UserRepository extends VSRepository<User, string, MyOrmTypes> { ... }
 * ```
 *
 * @publicApi
 */
export type Prisma7OrmTypes<
    DB extends Prisma7ClientLike,
    TX extends Omit<Prisma7ClientLike, "$on"> | undefined = undefined,
> = {
    dbClient: DB;
    dbTransaction: TX extends undefined ? TxParam<DB> : TX;
};
