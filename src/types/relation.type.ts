import { KeysOfType, Primitive } from "vsrepo";

/**
 * Cardinality of a relation from the point of view of the entity that owns the
 * field: `oto` = one-to-one, `mto` = many-to-one, `otm` = one-to-many and
 * `mtm` = many-to-many.
 *
 * @publicApi
 */
export type RelationMode = "oto" | "mto" | "otm" | "mtm";

/**
 * How a to-one relation (`oto`/`mto`) is written on update when the related
 * object has its `pk`. Pick it through `Relation.onUpdate`.
 *
 * - `"connect"` (default) — only connects the record. It never creates nor
 *   overwrites the related record, so re-sending the one that is already
 *   connected is a no-op and switching to another record works. Fails with
 *   Prisma's `P2025` when the record doesn't exist.
 * - `"connectOrCreate"` — connects the record, creating it when missing.
 * - `"upsert"` — updates the related record with the fields you sent (everything
 *   but its `pk`), creating it when missing.
 *
 * Without the related `pk` there is nothing to connect to: the record is
 * created (`"upsert"` still sends its fields as the `update`).
 *
 * @publicApi
 */
export type ToOneStrategy = "connect" | "connectOrCreate" | "upsert";

/**
 * How a to-many relation (`otm`/`mtm`) is written on update. Pick it through
 * `Relation.onUpdate`.
 *
 * - `"add"` (default) — only creates/connects/upserts the items you send.
 *   Whatever else is already related is left untouched.
 * - `"set"` — also removes (`otm`: `deleteMany`) or disconnects (`mtm`: `set`)
 *   every related item that wasn't sent.
 *
 * @publicApi
 */
export type ToManyStrategy = "add" | "set";

/**
 * What sending `null` to a to-one relation does on update. Pick it through
 * `Relation.onDisconnect`.
 *
 * - `"disconnect"` (default) — detaches the related record and keeps it.
 *   Needs the relation (its FK) to be optional.
 * - `"delete"` — deletes the related record. It is always opt-in. On an `mto`
 *   the related record is shared with other rows, so deleting it affects all of them.
 *
 * @publicApi
 */
export type DisconnectStrategy = "disconnect" | "delete";

/** Options shared by every relation mode. */
type RelationBase<T, M extends RelationMode> = {
    /**
     * Cardinality of the relation from the point of view of the entity
     * that owns the field. It decides which of the other options are available.
     */
    mode: M;
    /**
     * Name of the field used as the identifier of the related record,
     * used to decide between `create` (no pk in the payload) and
     * connecting to / upserting an existing record (pk present).
     */
    pk: (KeysOfType<T, Primitive> & string) | (string & {});
    /**
     * Name of the scalar foreign key that lives in the **related** entity —
     * e.g. `userId` in `User.address`, where `Address` holds the FK. The
     * adapter strips it from the related payload(s) before building the
     * nested write, since the relation already sets it.
     */
    fkThere?: (KeysOfType<T, Primitive> & string) | (string & {});
};

/** Options of the `oto` and `mto` relations. */
type ToOneOptions<K> = {
    /**
     * Name of the scalar foreign key that lives in **this** entity (the one
     * that owns the relation field) — e.g. `userId` in `Address.user`. Set it
     * on the owning side of the relation.
     *
     * Prisma doesn't accept the scalar FK next to the relation object, so when
     * the relation is in the payload the adapter drops this field from
     * `create` and `update`. For the same reason it also can't keep the
     * entity's primary key: if the payload has one, the write throws
     * `INVALID_DATA` unless `allowOmitPk` is enabled (see
     * `Prisma7AdapterConfig.allowOmitPk`).
     */
    fkHere?: (KeysOfType<K, Primitive> & string) | (string & {});
    /**
     * How the related record is written on update when the payload has its `pk`.
     * @default "connect"
     */
    onUpdate?: ToOneStrategy;
    /**
     * What sending `null` does on update.
     * @default "disconnect"
     */
    onDisconnect?: DisconnectStrategy;
};

/** Options of the `otm` and `mtm` relations. */
type ToManyOptions = {
    /**
     * How the related items are written on update.
     * @default "add"
     */
    onUpdate?: ToManyStrategy;
};

/**
 * Configuration of a single relation field:
 *
 * - `oto` and `mto`: `fkHere`, `fkThere`, `onUpdate` ({@link ToOneStrategy}) and
 *   `onDisconnect` ({@link DisconnectStrategy}).
 * - `otm` and `mtm`: `fkThere` and `onUpdate` ({@link ToManyStrategy}).
 *
 * Set a relation to `"ignore"` in `AdapterRelations` to leave it out of every
 * write (see `AdapterRelations`).
 *
 * @template T Type of the related entity.
 * @template K Type of the entity that owns the relation field.
 * @template M Narrows the config to some of the modes (all of them by default).
 *
 * @publicApi
 */
export type Relation<T = any, K = any, M extends RelationMode = RelationMode> = M extends "oto" | "mto"
    ? RelationBase<T, M> & ToOneOptions<K>
    : M extends "otm" | "mtm"
      ? RelationBase<T, M> & ToManyOptions
      : never;
