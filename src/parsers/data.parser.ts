/**
 * Parser que converte um `DeepPartial<T>` (formato "cru" vindo do vsrepo) nos
 * payloads `create`/`update` esperados pelo Prisma para escritas com relations,
 * replicando o comportamento da v1 (`resolveCreateUpdatePayloadsWithRelations`).
 *
 * Sem `relations` configurado no adapter, cada campo é repassado como está —
 * exceto `pkName`, que é omitido do `update` (não faz sentido reatribuir a PK
 * num update parcial).
 *
 * Com `relations`, cada campo de relação é resolvido de acordo com seu `mode`/
 * `restriction` (ver `Relation`):
 *  - to-one (`oto`/`mto`) sem PK no valor enviado -> `create` (e `upsert` no
 *    update, a não ser que `restriction: "add"`, que usa só `create`)
 *  - to-one com PK no valor enviado               -> `connectOrCreate` (e
 *    `upsert` no update, a não ser que `restriction: "add"`)
 *  - to-one enviado como `null` com `nullable`     -> `delete` (`oto` +
 *    `restriction: "set"`) ou `disconnect` (`oto` com `restriction: "add"` /
 *    `mto`; um `oto` não "desconecta" no `update`, a linha possuída é apagada)
 *  - to-one enviado como `null` sem `nullable`     -> lança `VSRepoAdapterError`
 *    (code `INVALID_DATA`)
 *  - to-many (`otm`/`mtm`) — itens são separados entre "com PK" e "sem PK":
 *    os sem PK viram `create`, os com PK viram `connectOrCreate` no create e
 *    `upsert` no update; com `restriction: "set"`, itens de `otm` que não
 *    vieram no array são removidos (`deleteMany`) e itens de `mtm` têm o
 *    vínculo resetado (`set: []`) antes de reconectar
 *
 * Essa mesma saída `{ create, update }` é reaproveitada em todos os métodos de
 * escrita do adapter: `create()` usa só `.create`, `update()`/`updateMany()`
 * usam só `.update`, e `save()`/`upsert()` usam os dois.
 */

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
): PrismaWriteData {
    const create: PlainObject = {};
    const update: PlainObject = {};

    for (const [key, field] of Object.entries(obj)) {
        if (field === undefined) continue;

        const relation = (relations as PlainObject | undefined)?.[key] as Relation<{}> | undefined;

        if (!relation) {
            create[key] = field;
            if (key !== pkName) update[key] = field;
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
