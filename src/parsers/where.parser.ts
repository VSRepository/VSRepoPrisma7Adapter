import { AdapterErrorCode, VSRepoAdapterError, VSRepoWhere } from "vsrepo";
import { PlainObject } from "../types/plain-object.type.js";
import { isPlainObject } from "../validators/is-plain-object.validator.js";

const LOGICAL_KEYS = new Set(["AND", "OR", "NOT"]);

function parseFieldValue(value: unknown): unknown {
    if (!isPlainObject(value)) {
        return value;
    }

    const result: PlainObject = {};

    for (const [key, val] of Object.entries(value)) {
        if (val === undefined) continue;

        switch (key) {
            case "ignoreCase":
                if (val === true) result.mode = "insensitive";
                break;

            case "between": {
                const [min, max] = val as [any, any];
                if (min !== undefined) result.gte = min;
                if (max !== undefined) result.lte = max;
                break;
            }

            case "not": {
                result.not = isPlainObject(val) ? parseFieldValue(val) : val;
                break;
            }

            case "_some": {
                result.some = parsePrismaWhere(value._some as VSRepoWhere<unknown>);
                break;
            }

            case "_every": {
                result.every = parsePrismaWhere(value._every as VSRepoWhere<unknown>);
                break;
            }

            case "_none": {
                result.none = parsePrismaWhere(value._none as VSRepoWhere<unknown>);
                break;
            }

            case "_with": {
                result.is = parsePrismaWhere(value._with as VSRepoWhere<unknown>);
                break;
            }

            case "_without": {
                result.isNot = parsePrismaWhere(value._without as VSRepoWhere<unknown>);
                break;
            }

            case "like": {
                throw new VSRepoAdapterError(
                    `The 'like' operator is not supported by the Prisma adapter, since Prisma has no equivalent. ` +
                        `Use 'contains', 'startsWith' or 'endsWith' instead.`,
                    AdapterErrorCode.NOT_SUPPORTED,
                    null,
                );
            }

            default:
                result[key] = val;
        }
    }

    return result;
}

export function parsePrismaWhere<T>(where: VSRepoWhere<T> | undefined): PlainObject | undefined {
    if (where === undefined) return undefined;

    const result: PlainObject = {};

    for (const [key, value] of Object.entries(where)) {
        if (value === undefined) continue;

        if (LOGICAL_KEYS.has(key)) {
            result[key] = Array.isArray(value) ? value.map(v => parsePrismaWhere(v)) : parsePrismaWhere(value);
            continue;
        }

        result[key] = parseFieldValue(value);
    }

    return result;
}
