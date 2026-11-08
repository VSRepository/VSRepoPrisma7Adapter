import { AdapterErrorCode, VSRepoAdapterError } from "vsrepo";
import { AdapterRelations } from "../types/adapter-relations.type.js";
import { PlainObject } from "../types/plain-object.type.js";
import { Relation } from "../types/relation.type.js";

export interface PrismaWriteData {
    create: PlainObject;
    update: PlainObject;
}

function omitKey(item: PlainObject, key: string): PlainObject {
    const clone = { ...item };
    delete clone[key];
    return clone;
}

/** Default `restriction` applied when the relation config doesn't set one. */
const DEFAULT_RESTRICTION = "add";

function splitByPk(items: PlainObject[], pk: string): { withPk: PlainObject[]; withoutPk: PlainObject[] } {
    const withPk: PlainObject[] = [];
    const withoutPk: PlainObject[] = [];

    for (const item of items) {
        (item[pk] !== undefined ? withPk : withoutPk).push(item);
    }

    return { withPk, withoutPk };
}

function parseToOneRelation(
    field: PlainObject | null,
    relation: Relation<{}>,
): { create?: PlainObject; update?: PlainObject } {
    const restriction = relation.restriction ?? DEFAULT_RESTRICTION;

    if (field === null) {
        if (!relation.nullable) {
            throw new VSRepoAdapterError(
                `You cannot provide null for a to-one relation when it is not nullable.`,
                AdapterErrorCode.INVALID_DATA,
                null,
            );
        }
        if (relation.mode === "oto") {
            if (restriction === "set") {
                return { update: { delete: true } };
            }
            return { update: { disconnect: true } };
        }
        // relation.mode === "mto"
        return { update: { disconnect: true } };
    }

    if (relation.fkThere !== undefined) {
        field = omitKey(field, relation.fkThere);
    }

    const pkValue = field[relation.pk];

    if (pkValue === undefined) {
        return {
            create: { create: field },
            update: restriction === "add" ? { create: field } : { upsert: { create: field, update: field } },
        };
    }

    const connectOrCreate = { where: { [relation.pk]: pkValue }, create: field };

    return {
        create: { connectOrCreate },
        update:
            restriction === "add"
                ? relation.mode === "mto"
                    ? { connectOrCreate }
                    : {
                          upsert: {
                              where: { [relation.pk]: pkValue },
                              create: field,
                              update: {},
                          },
                      }
                : {
                      upsert: {
                          where: { [relation.pk]: pkValue },
                          create: field,
                          update: omitKey(field, relation.pk),
                      },
                  },
    };
}

function parseToManyRelation(
    field: PlainObject[],
    relation: Relation<{}>,
): { create: PlainObject; update: PlainObject } {
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

    const restriction = relation.restriction ?? DEFAULT_RESTRICTION;

    if (restriction === "add") {
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
        if (field === undefined) continue;

        const relation = (relations as PlainObject | undefined)?.[key] as Relation<{}> | undefined;

        if (!relation) {
            create[key] = field;
            if (!omitPkInUpdate || key !== pkName) update[key] = field;
            continue;
        }

        if (relation.fkHere !== undefined) {
            fkHereRelations.push(key);
            keysToOmit.push(relation.fkHere as string);
        }

        if (relation.mode === "oto" || relation.mode === "mto") {
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
