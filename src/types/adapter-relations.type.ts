import type { RelationKeys } from "vsrepo";
import { Relation } from "./relation.type.js";

/**
 * Relation configuration for entity `T`, used by the write parsers to resolve
 * relation fields into Prisma nested writes (see `Relation`).
 *
 * Keyed by the relation fields of `T` (`RelationKeys<T>`); each value is a
 * `Relation` config, whose options depend on its `mode`.
 *
 * A relation that is not configured here is left out of every write
 * (`create`, `update`, `save`...): the adapter only writes the scalar fields
 * of the model and the relations configured in this object. To load a
 * relation without persisting it through this entity, just don't configure it.
 * Since the relation object is dropped, a scalar FK in the payload (e.g.
 * `userId`) is sent as is, together with the primary key.
 *
 * @publicApi
 */
export type AdapterRelations<T> = Partial<{
    [P in RelationKeys<T>]: Relation<NonNullable<T[P]> extends Array<infer U> ? U : NonNullable<T[P]>, T>;
}>;
