import { AdapterErrorCode, VSRepoAdapterError } from "vsrepo";
import { AdapterRelations } from "../types/adapter-relations.type.js";
import { PlainObject } from "../types/plain-object.type.js";
import type { Relation, ToOneStrategy } from "../types/relation.type.js";

export interface PrismaWriteData {
    create: PlainObject;
    update: PlainObject;
}

function omitKey(item: PlainObject, key: string): PlainObject {
    const clone = { ...item };
    delete clone[key];
    return clone;
}

function splitByPk(items: PlainObject[], pk: string): { withPk: PlainObject[]; withoutPk: PlainObject[] } {
    const withPk: PlainObject[] = [];
    const withoutPk: PlainObject[] = [];

    for (const item of items) {
        (item[pk] !== undefined ? withPk : withoutPk).push(item);
    }

    return { withPk, withoutPk };
}

const DEFAULT_TO_ONE_FK_HERE_STRATEGY = "connect";
const DEFAULT_TO_ONE_FK_THERE_STRATEGY = "connectOrCreate";
/** `Relation.onUpdate` of a to-many relation when the config doesn't set one. */
const DEFAULT_TO_MANY_STRATEGY = "add";
/** `Relation.onDisconnect` of a to-one relation when the config doesn't set one. */
const DEFAULT_DISCONNECT_STRATEGY = "disconnect";

/**
 * `update` half of a to-one relation whose related object has its `pk`,
 * according to the relation's `onUpdate` ({@link ToOneStrategy}).
 */
function resolveExistingToOneUpdate(
    strategy: ToOneStrategy,
    pk: string,
    where: PlainObject,
    field: PlainObject,
): PlainObject {
    switch (strategy) {
        case "connect":
            return { connect: where };
        case "connectOrCreate":
            return { connectOrCreate: { where, create: field } };
        case "upsert":
            return { upsert: { where, create: field, update: omitKey(field, pk) } };
    }
}

function parseToOneRelation(
    field: PlainObject | null,
    relation: Relation<any, any, "oto" | "mto">,
): { create?: PlainObject; update?: PlainObject } {
    const updateStrategy =
        relation.onUpdate ??
        (relation.fkThere !== undefined ? DEFAULT_TO_ONE_FK_THERE_STRATEGY : DEFAULT_TO_ONE_FK_HERE_STRATEGY);

    if (field === null) {
        const disconnectStrategy = relation.onDisconnect ?? DEFAULT_DISCONNECT_STRATEGY;

        return disconnectStrategy === "delete" ? { update: { delete: true } } : { update: { disconnect: true } };
    }

    if (relation.fkThere !== undefined) {
        field = omitKey(field, relation.fkThere);
    }

    const pkValue = field[relation.pk];

    if (pkValue === undefined) {
        return {
            create: { create: field },
            update: updateStrategy === "upsert" ? { upsert: { create: field, update: field } } : { create: field },
        };
    }

    const where = { [relation.pk]: pkValue };

    return {
        create: { connectOrCreate: { where, create: field } },
        update: resolveExistingToOneUpdate(updateStrategy, relation.pk, where, field),
    };
}

function parseToManyRelation(
    field: PlainObject[],
    relation: Relation<any, any, "otm" | "mtm">,
): { create: PlainObject; update: PlainObject } {
    const updateStrategy = relation.onUpdate ?? DEFAULT_TO_MANY_STRATEGY;

    if (relation.fkThere !== undefined) {
        field = field.map(f => omitKey(f, relation.fkThere!));
    }

    const { withPk, withoutPk } = splitByPk(field, relation.pk);

    const connectOrCreate = withPk.map(item => ({
        where: { [relation.pk]: item[relation.pk] },
        create: item,
    }));

    const upsert =
        relation.mode === "mtm"
            ? undefined
            : withPk.map(item => ({
                  where: { [relation.pk]: item[relation.pk] },
                  create: item,
                  update: omitKey(item, relation.pk),
              }));

    const create = { create: withoutPk, connectOrCreate };

    if (updateStrategy === "add") {
        return {
            create,
            update: relation.mode === "mtm" ? { create: withoutPk, connectOrCreate } : { create: withoutPk, upsert },
        };
    }

    return {
        create,
        update:
            relation.mode === "mtm"
                ? { set: [], create: withoutPk, connectOrCreate }
                : {
                      deleteMany: {
                          [relation.pk]: { notIn: withPk.map(item => item[relation.pk]) },
                      },
                      create: withoutPk,
                      upsert,
                  },
    };
}

export function parsePrismaWriteData<T>(
    obj: PlainObject,
    pkName: string,
    knownKeys: ReadonlySet<string>,
    relations?: AdapterRelations<T>,
    omitPkInUpdate = false,
    allowOmitPkWhenNeeded = false,
): PrismaWriteData {
    let create: PlainObject = {};
    let update: PlainObject = {};

    /** Relation fields that hold their FK in this entity, and those FK fields. */
    const fkHereRelations: string[] = [];
    const keysToOmit: string[] = [];

    for (const [key, field] of Object.entries(obj)) {
        if (field === undefined || !knownKeys.has(key)) continue;

        const relation = (relations as PlainObject | undefined)?.[key] as Relation | undefined;

        if (!relation) {
            create[key] = field;
            if (!omitPkInUpdate || key !== pkName) update[key] = field;
            continue;
        }

        if (relation.mode === "oto" || relation.mode === "mto") {
            if (relation.fkHere !== undefined) {
                fkHereRelations.push(key);
                keysToOmit.push(relation.fkHere);
            }

            const parsed = parseToOneRelation(field, relation);
            if (parsed.create !== undefined) create[key] = parsed.create;
            if (parsed.update !== undefined) update[key] = parsed.update;
            continue;
        }

        const parsed = parseToManyRelation(field as PlainObject[], relation);
        create[key] = parsed.create;
        update[key] = parsed.update;
    }

    if (fkHereRelations.length) {
        if (obj[pkName] !== undefined) {
            if (!allowOmitPkWhenNeeded) {
                const fields = fkHereRelations.map(name => `'${name}'`).join(", ");

                throw new VSRepoAdapterError(
                    `Cannot send the primary key '${pkName}' together with the relation field(s) ${fields}: ` +
                        `they hold their foreign key in this same entity, and Prisma rejects the primary key ` +
                        `in a nested write of that kind ("Unknown argument"). ` +
                        `Either remove '${pkName}' from the payload, or set 'allowOmitPk: true' (in the adapter ` +
                        `config, or globally through 'setGlobalConfig') so the adapter drops it. Note that, with ` +
                        `'allowOmitPk', a record that doesn't exist yet is created with a database-generated ` +
                        `'${pkName}' instead of the one you sent.`,
                    AdapterErrorCode.INVALID_DATA,
                    null,
                );
            }

            keysToOmit.push(pkName);
        }

        for (const key of keysToOmit) {
            create = omitKey(create, key);
            update = omitKey(update, key);
        }
    }

    return { create, update };
}
