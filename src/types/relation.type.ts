/**
 * Configuration of a single relation field.
 *
 * @publicApi
 */
export interface Relation<T = any> {
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
     */
    restriction: "set" | "add";
    /**
     * Name of the field used as the identifier of the related record,
     * used to decide between `create` (no pk in the payload) and
     * `connectOrCreate`/`upsert` (pk present).
     */
    pk: keyof T;
    /**
     * For `oto`/`mto` relations, whether the field accepts being set
     * to `null`. When `true`, sending `null` on update resolves to `delete`
     * (`oto` + `restriction: "set"`) or `disconnect` (`oto` + `restriction:
     * "add"`, and `mto`). When `false`/omitted, sending `null` for a to-one
     * relation throws a `VSRepoAdapterError` (code `INVALID_DATA`).
     */
    nullable?: boolean;
}
