import type { RelationKeys } from "vsrepo";
import { Relation } from "./relation.type.js";

/**
 * Relation configuration for entity `T`, used by the `create`/`update`/`merge`
 * parsers to resolve relation fields according to the v1 behavior (see
 * `Relation`).
 *
 * Keyed by the relation fields of `T` (`RelationKeys<T>`). Without this
 * configuration (adapter built without `relations`), relation fields are
 * passed through to Prisma as-is, with no special resolution.
 *
 * @publicApi
 */
export type AdapterRelations<T> = Partial<{
    [P in RelationKeys<T>]: Relation<NonNullable<T[P]> extends Array<infer U> ? U : NonNullable<T[P]>>;
}>;
