/**
 * Duck-typing for a PrismaClient.
 *
 * @publicApi
 */
export type Prisma7ClientLike = {
    $executeRaw: any;
    $executeRawUnsafe: any;
    $queryRaw: any;
    $queryRawUnsafe: any;
    $on: any;
    $transaction?: (fn: (tx: any) => any) => any;
};
