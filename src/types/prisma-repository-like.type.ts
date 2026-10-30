import { PrismaArgLike } from "./prisma-arg-like.type.js";

type AnyFn = (arg: PrismaArgLike) => Promise<any>;
/** `count` do Prisma resolve pra um `number` (na forma simples, sem `select` de agregação). */
type CountFn = (arg: PrismaArgLike) => Promise<number>;
/**
 * `aggregate` do Prisma resolve pra um objeto com uma chave por operação
 * pedida (`_sum`/`_avg`/`_min`/`_max`/`_count`), cada uma mapeando campo ->
 * valor agregado (`number | bigint | Decimal | null`).
 */
type AggregateFn = (
    arg: PrismaArgLike & Record<string, Record<string, boolean>>,
) => Promise<Record<string, Record<string, unknown> | undefined>>;

export type PrismaRepositoryLike = {
    findFirst: AnyFn;
    findFirstOrThrow: AnyFn;
    findMany: AnyFn;
    create: AnyFn;
    createMany: AnyFn;
    createManyAndReturn: AnyFn;
    update: AnyFn;
    updateMany: AnyFn;
    updateManyAndReturn: AnyFn;
    upsert: AnyFn;
    delete: AnyFn;
    deleteMany: AnyFn;
    count: CountFn;
    aggregate: AggregateFn;
};
