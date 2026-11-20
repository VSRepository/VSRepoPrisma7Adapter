import { VSRepoRelations, VSRepoRelationsOptions } from "vsrepo";
import { PlainObject } from "../types/plain-object.type.js";
import { PrismaProvider } from "../types/prisma-provider.type.js";
import { isPlainObject } from "../validators/is-plain-object.validator.js";
import { parsePrismaRelationArgs } from "./relation-options.parser.js";

/**
 * Converts `relations` into a Prisma `include`, applying the matching `relationsOptions`
 * (`where`, `orderBy`, `skip`, `take`) to each relation that is being loaded.
 *
 * The options of a relation that isn't loaded (absent or `false` in `relations`) are ignored.
 */
export function parsePrismaInclude<T>(
    relations: VSRepoRelations<T>,
    relationsOptions?: VSRepoRelationsOptions<T>,
    provider?: PrismaProvider,
): PlainObject {
    const include: PlainObject = {};

    for (const [key, value] of Object.entries(relations)) {
        const options = value ? (relationsOptions as PlainObject | undefined)?.[key] : undefined;
        const args = parsePrismaRelationArgs(options, provider);

        if (isPlainObject(value)) {
            include[key] = { ...args, include: parsePrismaInclude(value, options?.relationsOptions, provider) };
        } else if (value && Object.keys(args).length > 0) {
            include[key] = args;
        } else {
            include[key] = value;
        }
    }

    return include;
}
