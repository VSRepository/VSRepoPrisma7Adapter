import { Prisma7ClientLike } from "./prisma7-client-like.type.js";

/**
 * Extracts the model/delegate names from a Prisma Client instance type,
 * excluding all built-in `$`-prefixed methods (`$connect`, `$transaction`, etc.).
 *
 * The resulting union contains only the keys that represent actual Prisma model
 * delegates (e.g. `"user"`, `"post"`, `"comment"`), enabling type-safe
 * auto-complete when configuring `modelName` in `VSRepoPrisma7AdapterConfig`.
 *
 * @template T - A Prisma Client type that extends `Prisma7ClientLike`.
 *
 * @example
 * ```ts
 * import { PrismaClient } from "@prisma/client";
 *
 * // Resolves to: "user" | "post" | "comment" | ...
 * type Models = PrismaClientModels<PrismaClient>;
 * ```
 *
 * @publicApi
 */
export type PrismaClientModels<T extends Prisma7ClientLike> = Exclude<
    keyof T,
    | "$connect"
    | "$disconnect"
    | "$executeRaw"
    | "$executeRawUnsafe"
    | "$extends"
    | "$on"
    | "$queryRaw"
    | "$queryRawUnsafe"
    | "$transaction"
    | symbol
    | number
>;
