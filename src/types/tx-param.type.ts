import { Prisma7ClientLike } from "./prisma7-client-like.type.js";

/**
 * @publicApi
 */
export type TxParam<DB extends Prisma7ClientLike> = Parameters<Parameters<NonNullable<DB["$transaction"]>>[0]>[0];
