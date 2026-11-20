import { PlainObject } from "../types/plain-object.type.js";
import { PrismaProvider } from "../types/prisma-provider.type.js";
import { parsePrismaOrderBy } from "./order-by.parser.js";
import { parsePrismaWhere } from "./where.parser.js";

/**
 * Converts the options of a single relation (an entry of `relationsOptions`) into the Prisma args
 * that go next to its `select`/`include`: `where`, `orderBy`, `skip` and `take`.
 *
 * Only the keys that were provided are returned, so `{}` means there is nothing to configure
 * (the relation can stay a plain `true`).
 */
export function parsePrismaRelationArgs(options: PlainObject | undefined, provider?: PrismaProvider): PlainObject {
    const args: PlainObject = {};

    if (!options) return args;

    const { where, order, pagination } = options;

    const prismaWhere = parsePrismaWhere(where, provider);
    const prismaOrderBy = parsePrismaOrderBy(order);

    if (prismaWhere !== undefined) args.where = prismaWhere;
    if (prismaOrderBy !== undefined) args.orderBy = prismaOrderBy;
    if (pagination?.offset !== undefined) args.skip = pagination.offset;
    if (pagination?.limit !== undefined) args.take = pagination.limit;

    return args;
}
