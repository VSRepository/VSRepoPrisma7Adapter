/**
 * @publicApi
 */
export type RelationMode = "oto" | "mto" | "otm" | "mtm";

/**
 * @publicApi
 */
export type ToOneStrategy = "connectOrCreate" | "upsert";

/**
 * @publicApi
 */
export type ToManyStrategy = "add" | "set";

/**
 * @publicApi
 */
export type DisconnectStrategy = "disconnect" | "delete";

/**
 * @publicApi
 */
export type RelationPersistence<M extends RelationMode> = M extends "oto" | "mto"
    ? {
          onUpdate?: ToOneStrategy;
          onDisconnect?: DisconnectStrategy;
      }
    : {
          onUpdate?: ToManyStrategy;
      };

/**
 * Configuration of a single relation field.
 *
 * @template T Type of the related entity.
 * @template K Type of the entity that owns the relation field.
 *
 * @publicApi
 */
export type Relation<T = any, K = any, M extends RelationMode = RelationMode> = {
    /**
     * Cardinality of the relation from the point of view of the entity
     * that owns the field (`oto` = one-to-one, `mto` = many-to-one,
     * `otm` = one-to-many, `mtm` = many-to-many).
     */
    mode: "otm" | "mtm" | "mto" | "oto";
    /**
     * Name of the field used as the identifier of the related record,
     * used to decide between `create` (no pk in the payload) and
     * `connectOrCreate`/`upsert` (pk present).
     */
    pk: keyof T & string;

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
    fkHere?: keyof K & string;

    /**
     * Name of the scalar foreign key that lives in the **related** entity —
     * e.g. `userId` in `User.address`, where `Address` holds the FK. The
     * adapter strips it from the related payload(s) before building the
     * nested write, since the relation already sets it.
     */
    fkThere?: keyof T & string;
} & RelationPersistence<M>;
