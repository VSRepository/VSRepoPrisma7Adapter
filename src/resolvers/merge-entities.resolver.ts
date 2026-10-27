import { AdapterRelations } from "../types/adapter-relations.type.js";
import { PlainObject } from "../types/plain-object.type.js";
import { Relation } from "../types/relation.type.js";
import { isPlainObject } from "../validators/is-plain-object.validator.js";

/**
 * Shallow-merges `source` into a copy of `target`, skipping `undefined` values
 * so they never erase an existing field. Values (objects, arrays, `Date`,
 * `Decimal`...) are assigned by reference, never cloned nor merged.
 */
function assignDefined(target: PlainObject, source: PlainObject): PlainObject {
    const merged: PlainObject = { ...target };

    for (const [key, value] of Object.entries(source)) {
        if (value !== undefined) merged[key] = value;
    }

    return merged;
}

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
        targetMap.set(item[relationPk], targetItem ? assignDefined(targetItem, item) : item);
    }

    return [...targetMap.values(), ...targetWithoutPk, ...sourceWithoutPk];
}

/**
 * Merges `obj` into `result` WITHOUT mutating either of them.
 *
 * - Fields of `obj` that are `undefined` are ignored (they never erase a value).
 * - Only the fields configured in `relations` are merged: a to-one relation
 *   has its fields merged with the existing related object (`null` clears it),
 *   and a to-many relation is merged item by item, matching them by the
 *   relation's `pk`.
 * - Every other value — including objects and arrays that are not configured
 *   as relations, and the nested values of a merged related object — is
 *   replaced as a whole, never deep merged nor concatenated.
 */
export function mergeEntities<T extends PlainObject, U extends PlainObject>(
    result: T,
    obj: U,
    relations?: AdapterRelations<T>,
): U & T {
    const merged: PlainObject = { ...result };

    for (const [key, field] of Object.entries(obj)) {
        if (field === undefined) continue;

        const relation = (relations as PlainObject | undefined)?.[key] as Relation<{}> | undefined;

        if (!relation) {
            merged[key] = field;
            continue;
        }

        if ((relation.mode === "oto" || relation.mode === "mto") && isPlainObject(merged[key])) {
            merged[key] = field === null ? null : assignDefined(merged[key], field as PlainObject);
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
