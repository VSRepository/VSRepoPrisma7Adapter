/**
 * Faz o merge profundo, EM MEMÓRIA (sem persistir nada no banco), de `result`
 * (registro já encontrado) com `obj` (payload enviado) — réplica exata do
 * comportamento do `merge` da v1: ele só busca o registro e devolve o merge,
 * quem decide o que fazer com o resultado (ex: chamar `save` depois) é quem
 * chamou.
 *
 * Sem `relations`, é um deep merge padrão (arrays são concatenados). Com
 * `relations`:
 *  - to-one (`oto`/`mto`) recebe merge direto (ou vira `null` se `obj` mandar
 *    `null` explicitamente)
 *  - to-many (`otm`/`mtm`) casa os itens de `result[key]` com os de `obj[key]`
 *    pela `pk` configurada: item com PK que bate -> merge entre os dois; item
 *    sem correspondente -> apenas adicionado. Itens existentes que não
 *    aparecem em `obj[key]` são mantidos (merge nunca remove nada).
 */

import merge from "deepmerge";
import { AdapterRelations } from "../types/adapter-relations.type.js";
import { PlainObject } from "../types/plain-object.type.js";
import { Relation } from "../types/relation.type.js";
import { isPlainObject } from "../validators/is-plain-object.validator.js";

function mergeToManyRelation(target: PlainObject[], source: PlainObject[], relationPk: string): PlainObject[] {
    const targetMap = new Map<any, PlainObject>();
    const targetWithoutPk: PlainObject[] = [];

    for (const item of target) {
        if (item[relationPk] !== undefined) {
            targetMap.set(item[relationPk], item);
        } else {
            targetWithoutPk.push(item);
        }
    }

    const sourceWithoutPk: PlainObject[] = [];

    for (const item of source) {
        if (item[relationPk] === undefined) {
            sourceWithoutPk.push(item);
            continue;
        }

        const targetItem = targetMap.get(item[relationPk]);
        targetMap.set(item[relationPk], targetItem ? merge(targetItem, item) : item);
    }

    return [...targetMap.values(), ...targetWithoutPk, ...sourceWithoutPk];
}

export function mergeEntities<T extends PlainObject, U extends PlainObject>(
    result: T,
    obj: U,
    relations?: AdapterRelations<T>,
): U & T {
    if (!relations) {
        const definedObj: Partial<U> = {};
        for (const key of Object.keys(obj) as (keyof U)[]) {
            if (obj[key] !== undefined) definedObj[key] = obj[key];
        }

        return merge(result, definedObj, {
            arrayMerge: (target, source) => target.concat(source),
        }) as unknown as U & T;
    }

    const merged: PlainObject = { ...result };

    for (const [key, field] of Object.entries(obj)) {
        if (field === undefined) continue;

        const relation = (relations as PlainObject)[key] as Relation<{}> | undefined;

        if (!relation) {
            merged[key] = field;
            continue;
        }

        if ((relation.mode === "oto" || relation.mode === "mto") && isPlainObject(merged[key])) {
            merged[key] = field === null ? null : merge(merged[key], field as PlainObject);
            continue;
        }

        if ((relation.mode === "mtm" || relation.mode === "otm") && Array.isArray(merged[key])) {
            merged[key] = mergeToManyRelation(merged[key], field as PlainObject[], relation.pk);
            continue;
        }

        merged[key] = field;
    }

    return merged as unknown as U & T;
}
