import { AdapterErrorCode, VSRepoAdapterError, VSRepoWhere } from "vsrepo";
import { INSENSITIVE_MODE_PROVIDERS } from "../constants/provider-capabilities.constant.js";
import { PlainObject } from "../types/plain-object.type.js";
import { PrismaProvider } from "../types/prisma-provider.type.js";
import { isPlainObject } from "../validators/is-plain-object.validator.js";

const LOGICAL_KEYS = new Set(["AND", "OR", "NOT"]);

function parseFieldValue(value: unknown, provider?: PrismaProvider): unknown {
    if (!isPlainObject(value)) {
        return value;
    }

    const result: PlainObject = {};

    for (const [key, val] of Object.entries(value)) {
        if (val === undefined) continue;

        switch (key) {
            case "ignoreCase": {
                if (val !== true) break;

                if (provider && !INSENSITIVE_MODE_PROVIDERS.has(provider)) {
                    throw new VSRepoAdapterError(
                        `The 'ignoreCase' option is not supported by the '${provider}' provider, since Prisma only ` +
                            `supports case-insensitive filtering on PostgreSQL and CockroachDB. ` +
                            `Remove 'ignoreCase' to filter using the database's own collation rules.`,
                        AdapterErrorCode.NOT_SUPPORTED,
                        null,
                    );
                }

                result.mode = "insensitive";
                break;
            }

            case "between": {
                const [min, max] = val as [any, any];
                if (min !== undefined) result.gte = min;
                if (max !== undefined) result.lte = max;
                break;
            }

            case "not": {
                result.not = isPlainObject(val) ? parseFieldValue(val, provider) : val;
                break;
            }

            case "_some": {
                result.some = parsePrismaWhere(value._some as VSRepoWhere<unknown>, provider);
                break;
            }

            case "_every": {
                result.every = parsePrismaWhere(value._every as VSRepoWhere<unknown>, provider);
                break;
            }

            case "_none": {
                result.none = parsePrismaWhere(value._none as VSRepoWhere<unknown>, provider);
                break;
            }

            case "_with": {
                result.is = parsePrismaWhere(value._with as VSRepoWhere<unknown>, provider);
                break;
            }

            case "_without": {
                result.isNot = parsePrismaWhere(value._without as VSRepoWhere<unknown>, provider);
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

/**
 * Converts a `VSRepoWhere` into a Prisma `where`.
 */
export function parsePrismaWhere<T>(
    where: VSRepoWhere<T> | undefined,
    provider?: PrismaProvider,
): PlainObject | undefined {
    if (where === undefined) return undefined;

    const result: PlainObject = {};

    for (const [key, value] of Object.entries(where)) {
        if (value === undefined) continue;

        if (LOGICAL_KEYS.has(key)) {
            result[key] = Array.isArray(value)
                ? value.map(v => parsePrismaWhere(v, provider))
                : parsePrismaWhere(value, provider);
            continue;
        }

        result[key] = parseFieldValue(value, provider);
    }

    return result;
}
