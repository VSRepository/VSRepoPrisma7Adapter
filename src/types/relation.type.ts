/**
 * Configuration of a single relation field.
 *
 * @template T Type of the related entity.
 * @template K Type of the entity that owns the relation field.
 *
 * @publicApi
 */
export interface Relation<T = any, K = any> {
    /**
     * Cardinality of the relation from the point of view of the entity
     * that owns the field (`oto` = one-to-one, `mto` = many-to-one,
     * `otm` = one-to-many, `mtm` = many-to-many).
     */
    mode: "otm" | "mtm" | "mto" | "oto";
    /**
     * How `save`/`update`/`upsert` handle to-many relations
     * (`otm`/`mtm`) and to-one relations pointing to an already-existing record
     * (matched by `pk`) — `"add"` only creates/connects the items that were
     * sent (upsert per item), `"set"` also removes/disconnects whatever wasn't
     * sent.
     * @default "add"
     */
    restriction?: "set" | "add";
    /**
     * Name of the field used as the identifier of the related record,
     * used to decide between `create` (no pk in the payload) and
     * `connectOrCreate`/`upsert` (pk present).
     */
    pk: keyof T;

    /**
     * Name of the scalar foreign key that lives in **this** entity (the one
     * that owns the relation field) — e.g. `userId` in `Address.user`. Set it
     * on the owning side of an `oto`/`mto` relation.
     *
     * Prisma doesn't accept the scalar FK next to the relation object, so when
     * the relation is in the payload the adapter drops this field from
     * `create` and `update`. For the same reason it also can't keep the
     * entity's primary key: if the payload has one, the write throws
     * `INVALID_DATA` unless `allowOmitPk` is enabled (see
     * `Prisma7AdapterConfig.allowOmitPk`).
     */
    fkHere?: keyof K;

    /**
     * Name of the scalar foreign key that lives in the **related** entity —
     * e.g. `userId` in `User.address`, where `Address` holds the FK. The
     * adapter strips it from the related payload(s) before building the
     * nested write, since the relation already sets it.
     */
    fkThere?: keyof T;

    /**
     * For `oto`/`mto` relations, whether the field accepts being set
     * to `null`. When `true`, sending `null` on update resolves to `delete`
     * (`oto` + `restriction: "set"`) or `disconnect` (`oto` + `restriction:
     * "add"`, and `mto`). When `false`/omitted, sending `null` for a to-one
     * relation throws a `VSRepoAdapterError` (code `INVALID_DATA`).
     */
    nullable?: boolean;
}
