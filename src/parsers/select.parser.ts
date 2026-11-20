import { VSRepoRelationsOptions, VSRepoSelect } from "vsrepo";
import { PlainObject } from "../types/plain-object.type.js";
import { PrismaProvider } from "../types/prisma-provider.type.js";
import { isPlainObject } from "../validators/is-plain-object.validator.js";
import { parsePrismaRelationArgs } from "./relation-options.parser.js";

/**
 * Converts `select` into a Prisma `select`, applying the matching `relationsOptions`
 * (`where`, `orderBy`, `skip`, `take`) to each relation that is being selected.
 *
 * The options of a relation that isn't selected (absent or `false` in `select`) are ignored.
 */
export function parsePrismaSelect<T>(
    relations: VSRepoSelect<T>,
    relationsOptions?: VSRepoRelationsOptions<T>,
    provider?: PrismaProvider,
): PlainObject {
    const select: PlainObject = {};

    for (const [key, value] of Object.entries(relations)) {
        const options = value ? (relationsOptions as PlainObject | undefined)?.[key] : undefined;
        const args = parsePrismaRelationArgs(options, provider);

        if (isPlainObject(value)) {
            select[key] = { ...args, select: parsePrismaSelect(value, options?.relationsOptions, provider) };
        } else if (value && Object.keys(args).length > 0) {
            select[key] = args;
        } else {
            select[key] = value;
        }
    }

    return select;
}
