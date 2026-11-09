import type { RelationKeys } from "vsrepo";
import { Relation } from "./relation.type.js";

/**
 * Relation configuration for entity `T`, used by the write parsers to resolve
 * relation fields into Prisma nested writes (see `Relation`).
 *
 * Keyed by the relation fields of `T` (`RelationKeys<T>`). Each value is either:
 *
 * - a `Relation` config, whose options depend on its `mode`; or
 * - `"ignore"`, which leaves the field out of every write (`create`, `update`,
 *   `save`...). Use it for a relation you load but don't want to persist
 *   through this entity. Since the relation object is dropped, a scalar FK in
 *   the payload (e.g. `userId`) is sent as is, together with the primary key.
 *
 * Without this configuration (adapter built without `relations`), relation
 * fields are passed through to Prisma as-is, with no special resolution.
 *
 * @publicApi
 */
export type AdapterRelations<T> = Partial<{
    [P in RelationKeys<T>]: "ignore" | Relation<NonNullable<T[P]> extends Array<infer U> ? U : NonNullable<T[P]>, T>;
}>;
