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
    if (field === null) {
        if (!relation.nullable) {
            throw new VSRepoAdapterError(
                `You cannot provide null for a to-one relation when it is not nullable.`,
                AdapterErrorCode.INVALID_DATA,
                null,
            );
        }
        if (relation.mode === "oto") {
            if (relation.restriction === "set") {
                return { update: { delete: true } };
            }
            return { update: { disconnect: true } };
        }
        // relation.mode === "mto"
        return { update: { disconnect: true } };
    }

    const pkValue = field[relation.pk];

    if (pkValue == undefined) {
        return {
            create: { create: field },
            update: relation.restriction === "add" ? { create: field } : { upsert: { create: field, update: field } },
        };
    }

    const connectOrCreate = { where: { [relation.pk]: pkValue }, create: field };

    return {
        create: { connectOrCreate },
        update:
            relation.restriction === "add"
                ? { connectOrCreate }
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

    if (relation.restriction === "add") {
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
): PrismaWriteData {
    const create: PlainObject = {};
    const update: PlainObject = {};

    for (const [key, field] of Object.entries(obj)) {
        if (field === undefined) continue;

        const relation = (relations as PlainObject | undefined)?.[key] as Relation<{}> | undefined;

        if (!relation) {
            create[key] = field;
            if (!omitPkInUpdate || key !== pkName) update[key] = field;
            continue;
        }

        if (relation.mode === "oto" || relation.mode === "mto") {
            const parsed = parseToOneRelation(field as PlainObject | null, relation);
            if (parsed.create !== undefined) create[key] = parsed.create;
            if (parsed.update !== undefined) update[key] = parsed.update;
            continue;
        }

        const parsed = parseToManyRelation(field as PlainObject[], relation);
        create[key] = parsed.create;
        update[key] = parsed.update;
    }

    return { create, update };
}
