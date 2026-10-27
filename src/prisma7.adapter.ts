import {
    AdapterErrorCode,
    AdapterMethodOptions,
    AdapterQueryOptions,
    CountResult,
    DecimalLike,
    DeepPartial,
    getPostgresPlaceholder,
    getSqlitePlaceholder,
    getSqlServerPlaceholder,
    NumericKeys,
    RestrictAdapterMethodOptions,
    SimpleAdapterMethodOptions,
    VSLogger,
    VSLogLevel,
    VSRepoAdapter,
    VSRepoAdapterError,
    VSRepoTransactionOptions,
    VSRepoWhere,
    WithIgnoreConflicts,
} from "vsrepo";
import { parsePrismaWhere } from "./parsers/where.parser.js";
import { parsePrismaInclude } from "./parsers/include.parser.js";
import { parsePrismaSelect } from "./parsers/select.parser.js";
import { parsePrismaOrderBy } from "./parsers/order-by.parser.js";
import { parsePrismaWriteData } from "./parsers/data.parser.js";
import { mergeEntities } from "./resolvers/merge-entities.resolver.js";
import { mapPrismaError } from "./resolvers/map-prisma-error.resolver.js";
import { resolveProvider } from "./resolvers/resolve-provider.resolver.js";
import { validatePrismaClient } from "./validators/validate-prisma-client.validator.js";
import { AdapterRelations } from "./types/adapter-relations.type.js";
import { Prisma7AdapterConfig } from "./types/adapter-config.type.js";
import { PrismaProvider } from "./types/prisma-provider.type.js";
import { PrismaArgLike } from "./types/prisma-arg-like.type.js";
import { PrismaRepositoryLike } from "./types/prisma-repository-like.type.js";
import { PlainObject } from "./types/plain-object.type.js";
import { Prisma7ClientLike } from "./types/prisma7-client-like.type.js";
import { isDecimal } from "./validators/is-decimal.validator.js";

/**
 * `VSRepoAdapter` implementation for Prisma 7.
 *
 * @template T Entity type this adapter operates on.
 *
 * @publicApi
 */
export class VSRepoPrisma7Adapter<T, K extends Prisma7ClientLike = Prisma7ClientLike> extends VSRepoAdapter<T> {
    private readonly modelName: string;
    private readonly pkName: string;
    private readonly relations?: AdapterRelations<T>;
    private readonly logger: VSLogger;
    private readonly provider: PrismaProvider;

    constructor(
        private readonly prisma: K,
        config: Prisma7AdapterConfig<T, K>,
    ) {
        super();

        validatePrismaClient(prisma, config.modelName);

        this.modelName = config.modelName;
        this.pkName = config.pkName as string;
        this.relations = config.relations;
        this.provider = resolveProvider(prisma, config.provider);
        this.logger = new VSLogger(config.logLevel ?? VSLogLevel.WARN, this.constructor.name + "Logger");

        this.logger.logInfo(
            `${this.constructor.name} initialized for table '${this.modelName}' (pkName: '${this.pkName}'${
                this.relations ? `, relations: [${Object.keys(this.relations).join(", ")}]` : ""
            }, provider: ${this.provider ? `'${this.provider}'` : "<not detected>"})`,
        );
    }

    private getPrismaRepository(db?: any): PrismaRepositoryLike {
        return db ? db[this.modelName] : (this.prisma as any)[this.modelName];
    }

    /** Resolves the "read" part of a Prisma arg: select/include/orderBy/pagination. */
    private resolveReadArg(options: AdapterMethodOptions<T> | undefined): PrismaArgLike {
        if (!options) return {};

        const prismaSelect = options.select && parsePrismaSelect(options.select);
        const prismaInclude = prismaSelect ? undefined : options.relations && parsePrismaInclude(options.relations);

        return {
            select: prismaSelect,
            include: prismaInclude,
            orderBy: parsePrismaOrderBy<T>(options.order),
            skip: options.pagination?.offset,
            take: options.pagination?.limit,
        };
    }

    /**
     * Strips relation fields from a payload — used by `createMany`/`updateMany`/
     * `updateManyReturning`, since those Prisma operations don't support nested
     * writes (scalar fields only). Throws a `VSRepoAdapterError` (code
     * `NOT_SUPPORTED`) instead of silently ignoring the field, when a configured
     * relation field is present in the payload.
     */
    private stripRelationFields(obj: PlainObject): PlainObject {
        if (!this.relations) return obj;

        const data: PlainObject = {};

        for (const [key, value] of Object.entries(obj)) {
            if (value === undefined) continue;

            if (key in (this.relations as PlainObject)) {
                throw new VSRepoAdapterError(
                    `Field '${key}' is a configured relation, but Prisma's *Many operations don't support nested relation writes.`,
                    AdapterErrorCode.NOT_SUPPORTED,
                    null,
                );
            }

            data[key] = value;
        }

        return data;
    }

    /**
     * Tells apart a root Prisma Client from an active transaction client: only
     * the root client exposes `$on` (used for event listeners), Prisma's
     * interactive transaction client doesn't (see `Prisma7ClientLike`).
     */
    private isRootClient(db: any): boolean {
        return typeof db?.$on === "function";
    }

    /**
     * Runs `fn` against a transaction, reusing `db` when it's already a
     * transaction client (see `isRootClient`) instead of nesting a new one —
     * this is what lets `saveMany`/`deleteManyReturning` participate in a
     * transaction already started via `VSRepository.transaction()`.
     * When `db` isn't provided, or is a root client, a new transaction is
     * started on it (or on `this.prisma` when `db` isn't provided at all).
     */
    private async runTransactional<R>(db: any, fn: (tx: any) => Promise<R>): Promise<R> {
        if (db && !this.isRootClient(db)) {
            this.logger.logDebug("Reusing an already-active transaction client");
            return fn(db);
        }

        return (db ?? this.prisma).$transaction(fn);
    }

    /**
     * Runs a single-field atomic update (`increment`/`decrement`/`multiply`/
     * `divide`) via Prisma's native `{ field: { <op>: value } }` write —
     * evaluated server-side against the row's current value, never as a
     * client-side read-modify-write. `value` is passed through as-is:
     * Prisma accepts a `number`, `bigint`, or any `Decimal`/`DecimalJsLike`
     * value (which covers a `DecimalLike` like `Prisma.Decimal`)
     * depending on the target column's type.
     *
     * Prisma's `update()` already returns the row reflecting the state
     * *after* the write, so no follow-up read is needed here.
     */
    private async atomicUpdate<K extends NumericKeys<T>>(
        operation: "increment" | "decrement" | "multiply" | "divide",
        field: K,
        value: NonNullable<T[K]>,
        where: VSRepoWhere<T>,
        options?: AdapterMethodOptions<T>,
    ): Promise<T> {
        const methodName = `${operation}One`;
        const start = this.logger.startPerformLog(`run ${methodName}`);

        try {
            const arg = {
                ...this.resolveReadArg(options),
                where: parsePrismaWhere(where),
                data: { [field]: { [operation]: value } },
            };
            this.logger.logDebug(`Resolved Prisma arg for ${methodName}`, arg);

            const result = await this.getPrismaRepository(options?.db).update(arg);

            this.logger.endPerformLog(start);

            return result;
        } catch (error) {
            this.logger.endPerformLog(start);

            throw mapPrismaError(error, methodName);
        }
    }

    private async atomicUpdateMany<K extends NumericKeys<T>>(
        operation: "increment" | "decrement" | "multiply" | "divide",
        field: K,
        value: NonNullable<T[K]>,
        where: VSRepoWhere<T>,
        options?: RestrictAdapterMethodOptions<T>,
    ): Promise<CountResult> {
        const methodName = `${operation}Many`;
        const start = this.logger.startPerformLog(`run ${methodName}`);

        try {
            const arg = {
                where: parsePrismaWhere(where),
                data: { [field]: { [operation]: value } },
            };
            this.logger.logDebug(`Resolved Prisma arg for ${methodName}`, arg);

            const result = await this.getPrismaRepository(options?.db).updateMany(arg);

            this.logger.endPerformLog(start);

            return result;
        } catch (error) {
            this.logger.endPerformLog(start);

            throw mapPrismaError(error, methodName);
        }
    }

    /**
     * Converts a raw value returned by Prisma's `aggregate()` (`number`,
     * `bigint`, a `Decimal` instance, or `null` when no record matches)
     * into the `number | null` shape required by the `VSRepoAdapter`
     * aggregate contract.
     */
    private toNullableNumber(value: unknown): number | null {
        if (value === null || value === undefined) return null;
        if (typeof value === "bigint") return Number(value);
        if (isDecimal(value)) {
            return value.toNumber();
        }
        return Number(value);
    }

    /**
     * Runs a single-field aggregation (`sum`/`avg`/`min`/`max`) via Prisma's
     * `aggregate()`, across every record matching `where` (all records if
     * empty). Returns `null` when no record matches — mirroring SQL's
     * `SUM()`/`AVG()`/`MIN()`/`MAX()`, which return `NULL` (not `0`) over an
     * empty set — instead of Prisma's own `_sum`/`_avg`/`_min`/`_max: null`
     * shape.
     */
    private async aggregate(
        operation: "sum" | "avg" | "min" | "max",
        field: NumericKeys<T>,
        where?: VSRepoWhere<T>,
        options?: RestrictAdapterMethodOptions<T>,
    ): Promise<number | null> {
        const start = this.logger.startPerformLog(`run ${operation}`);
        const aggKey = `_${operation}`;

        try {
            const arg = {
                where: parsePrismaWhere(where) as any,
                [aggKey]: { [field]: true },
            };
            this.logger.logDebug(`Resolved Prisma arg for ${operation}`, arg);

            const aggResult = await this.getPrismaRepository(options?.db).aggregate(arg);

            this.logger.endPerformLog(start);

            return this.toNullableNumber(aggResult?.[aggKey]?.[field as string]);
        } catch (error) {
            this.logger.endPerformLog(start);

            throw mapPrismaError(error, operation);
        }
    }

    /** Returns the underlying ORM client instance used outside of transactions. */
    getDbClient(): any {
        return this.prisma;
    }

    /** Runs `fn` inside a native transaction of the underlying ORM/database. */
    async runInTransaction<R>(fn: (tx: any) => Promise<R>, options?: VSRepoTransactionOptions): Promise<R> {
        try {
            return await (this.prisma as any).$transaction(fn, {
                isolationLevel: options?.isolationLevel,
                timeout: options?.timeoutMs,
            });
        } catch (error) {
            throw mapPrismaError(error, "runInTransaction");
        }
    }

    private async execMethod<R>(fn: () => Promise<R>, methodName: string, arg: object): Promise<R> {
        const start = this.logger.startPerformLog(`run ${methodName}`);

        try {
            this.logger.logDebug(`Resolved Prisma arg for ${methodName}`, arg);

            const result = await fn();

            this.logger.endPerformLog(start);

            return result;
        } catch (error) {
            this.logger.endPerformLog(start);

            throw mapPrismaError(error, methodName);
        }
    }

    /** Fetches a single record matching `where`. */
    async findOne(where?: VSRepoWhere<T>, options?: AdapterMethodOptions<T>): Promise<T | null> {
        const arg = { ...this.resolveReadArg(options), where: parsePrismaWhere(where) };

        return this.execMethod(() => this.getPrismaRepository(options?.db).findFirst(arg), "findOne", arg);
    }

    /** Fetches a single record matching `where`, throwing if none is found. */
    async findOneOrThrow(where?: VSRepoWhere<T>, options?: AdapterMethodOptions<T>): Promise<T> {
        const arg = { ...this.resolveReadArg(options), where: parsePrismaWhere(where) };

        return this.execMethod(
            () => this.getPrismaRepository(options?.db).findFirstOrThrow(arg),
            "findOneOrThrow",
            arg,
        );
    }

    /** Fetches all records matching `where`. */
    async findMany(where?: VSRepoWhere<T>, options?: AdapterMethodOptions<T>): Promise<T[]> {
        const arg = { ...this.resolveReadArg(options), where: parsePrismaWhere(where) };

        return this.execMethod(() => this.getPrismaRepository(options?.db).findMany(arg), "findMany", arg);
    }

    /** Creates or updates (upsert) a single record. */
    async save(obj: DeepPartial<T>, options?: SimpleAdapterMethodOptions<T>): Promise<T> {
        const objAny = obj as PlainObject;
        const pkValue = objAny[this.pkName];
        const readArg = this.resolveReadArg(options);
        const repo = this.getPrismaRepository(options?.db);
        const { create, update } = parsePrismaWriteData(objAny, this.pkName, this.relations, true);

        if (pkValue === undefined) {
            const arg = { ...readArg, data: create };

            return this.execMethod(() => repo.create(arg), "save (create)", arg);
        }

        const arg = { ...readArg, where: { [this.pkName]: pkValue }, create, update };

        return this.execMethod(() => repo.upsert(arg), "save (upsert)", arg);
    }

    /**
     * Creates or updates (upsert) multiple records. Prisma has no native bulk
     * upsert, so each record is saved individually inside a transaction —
     * reusing `options.db` when it's already a transaction client.
     */
    async saveMany(objs: DeepPartial<T>[], options?: SimpleAdapterMethodOptions<T>): Promise<T[]> {
        const start = this.logger.startPerformLog("run saveMany");

        try {
            this.logger.logDebug(`Saving ${objs.length} record(s) individually inside a transaction`);

            const result = await this.runTransactional(options?.db, async tx => {
                const optionsResolved = { ...options, db: tx };
                const saved: T[] = [];
                for (let i = 0; i < objs.length; i++) {
                    const obj = objs[i]!;
                    saved.push(await this.save(obj, optionsResolved));
                }
                return saved;
            });

            this.logger.endPerformLog(start);

            return result;
        } catch (error) {
            this.logger.endPerformLog(start);

            throw mapPrismaError(error, "saveMany");
        }
    }

    /** Deletes a single record matching `where`. */
    async delete(where: VSRepoWhere<T>, options?: SimpleAdapterMethodOptions<T>): Promise<T> {
        const arg = { ...this.resolveReadArg(options), where: parsePrismaWhere(where) };

        return this.execMethod(() => this.getPrismaRepository(options?.db).delete(arg), "delete", arg);
    }

    /** Deletes every record matching `where`, returning the count of affected rows. */
    async deleteMany(where: VSRepoWhere<T>, options?: RestrictAdapterMethodOptions<T>): Promise<CountResult> {
        const arg = { where: parsePrismaWhere(where) };

        return this.execMethod(() => this.getPrismaRepository(options?.db).deleteMany(arg), "deleteMany", arg);
    }

    /**
     * Deletes every record matching `where` and returns the deleted records.
     *
     * In the absence of a native `deleteManyAndReturn`, this fetches matching records
     * via `findMany` first, extracts their primary keys, and then deletes them by ID
     * using `{ [pkName]: { in: pks } }` inside a transaction.
     *
     * Key behaviors:
     * - **Primary Key Handling:** If `options.select` omits the primary key, it is
     *   temporarily added to the query so the subsequent batch delete can target
     *   those exact IDs, and stripped from the returned objects afterward.
     * - **Concurrency & Isolation:** Deleting strictly by the fetched IDs ensures only
     *   the exact returned rows are removed (avoiding deleting newly inserted rows that
     *   match `where`). However, if a row is modified or deleted concurrently between
     *   the read and the delete step, race conditions can still occur unless wrapped
     *   in a transaction with an appropriate isolation level (e.g., `SERIALIZABLE`).
     */
    async deleteManyReturning(where: VSRepoWhere<T>, options?: SimpleAdapterMethodOptions<T>): Promise<T[]> {
        const start = this.logger.startPerformLog("run deleteManyReturning");

        try {
            const prismaWhere = parsePrismaWhere(where);
            const findArg = { ...this.resolveReadArg(options), where: prismaWhere };

            const userRequestedPk = findArg.include || !findArg.select || !!(findArg.select as any)[this.pkName];

            if (!userRequestedPk) {
                (findArg.select as any)[this.pkName] = true;
            }

            this.logger.logDebug("Resolved Prisma args for deleteManyReturning", findArg);

            const result = await this.runTransactional(options?.db, async tx => {
                const repo = this.getPrismaRepository(tx);
                const records = await repo.findMany(findArg);

                if (records.length === 0) return [];

                const pks = records.map((rec: any) => rec[this.pkName]);

                await repo.deleteMany({ where: { [this.pkName]: { in: pks } } });

                return records;
            });

            if (!userRequestedPk) {
                for (const obj of result) {
                    delete obj[this.pkName];
                }
            }

            this.logger.endPerformLog(start);

            return result;
        } catch (error) {
            this.logger.endPerformLog(start);

            throw mapPrismaError(error, "deleteManyReturning");
        }
    }

    /** Updates a single record matching `where`. */
    async update(where: VSRepoWhere<T>, obj: DeepPartial<T>, options?: SimpleAdapterMethodOptions<T>): Promise<T> {
        const { update } = parsePrismaWriteData(obj as PlainObject, this.pkName, this.relations);
        const arg = {
            ...this.resolveReadArg(options),
            where: parsePrismaWhere(where),
            data: update,
        };

        return this.execMethod(() => this.getPrismaRepository(options?.db).update(arg), "update", arg);
    }

    /** Updates every record matching `where`, returning the count of affected rows. */
    async updateMany(
        where: VSRepoWhere<T>,
        obj: DeepPartial<T>,
        options?: RestrictAdapterMethodOptions<T>,
    ): Promise<CountResult> {
        const data = this.stripRelationFields(obj as PlainObject);
        const arg = { where: parsePrismaWhere(where), data };

        return this.execMethod(() => this.getPrismaRepository(options?.db).updateMany(arg), "updateMany", arg);
    }

    /** Updates every record matching `where`, returning the updated records. */
    async updateManyReturning(
        where: VSRepoWhere<T>,
        obj: DeepPartial<T>,
        options?: SimpleAdapterMethodOptions<T>,
    ): Promise<T[]> {
        const start = this.logger.startPerformLog("run updateManyReturning");

        try {
            const data = this.stripRelationFields(obj as PlainObject);
            const readArg = this.resolveReadArg(options);
            const arg = {
                ...readArg,
                where: parsePrismaWhere(where),
                data,
            };

            this.logger.logDebug("Resolved Prisma arg for updateManyReturning", arg);

            const result = await this.runTransactional(options?.db, async tx => {
                const repo = this.getPrismaRepository(tx);
                const updated = await repo.updateManyAndReturn({
                    ...arg,
                    include: undefined,
                    select: { [this.pkName]: true },
                });

                const idsUpdated = updated.map((_: any) => _[this.pkName]);

                return repo.findMany({
                    ...readArg,
                    where: { [this.pkName]: { in: idsUpdated } },
                });
            });

            this.logger.endPerformLog(start);

            return result;
        } catch (error) {
            this.logger.endPerformLog(start);

            throw mapPrismaError(error, "updateManyReturning");
        }
    }

    /** Returns the number of records matching `where`. */
    async count(where?: VSRepoWhere<T>, options?: RestrictAdapterMethodOptions<T>): Promise<number> {
        const arg = { where: parsePrismaWhere(where) };

        return this.execMethod(() => this.getPrismaRepository(options?.db).count(arg), "count", arg);
    }

    /** Checks whether at least one record matching `where` exists. */
    async exists(where?: VSRepoWhere<T>, options?: RestrictAdapterMethodOptions<T>): Promise<boolean> {
        const arg = { where: parsePrismaWhere(where), select: { [this.pkName]: true } };

        return this.execMethod(
            async () => {
                const result = await this.getPrismaRepository(options?.db).findFirst(arg);
                return result !== null;
            },
            "exists",
            arg,
        );
    }

    /** Executes a raw query/statement against the underlying database. */
    async query<R = any>(query: string, options?: AdapterQueryOptions): Promise<R> {
        const modifying = options?.modifying ?? false;
        const db = options?.db ?? this.prisma;
        const args = options?.args ?? [];

        const start = this.logger.startPerformLog(`run raw query (modifying: ${modifying})`);

        try {
            this.logger.logDebug("Running raw query", { query, args, modifying });

            const result = modifying
                ? await db.$executeRawUnsafe(query, ...args)
                : await db.$queryRawUnsafe(query, ...args);

            this.logger.endPerformLog(start);

            return result;
        } catch (error) {
            this.logger.endPerformLog(start);

            throw mapPrismaError(error, "query");
        }
    }

    /** Creates a single record. */
    async create(obj: DeepPartial<T>, options?: SimpleAdapterMethodOptions<T>): Promise<T> {
        const { create } = parsePrismaWriteData(obj as PlainObject, this.pkName, this.relations);
        const arg = { ...this.resolveReadArg(options), data: create };

        return this.execMethod(() => this.getPrismaRepository(options?.db).create(arg), "create", arg);
    }

    /**
     * Creates multiple records in a single operation.
     */
    async createMany(
        objs: DeepPartial<T>[],
        options?: WithIgnoreConflicts<RestrictAdapterMethodOptions<T>>,
    ): Promise<CountResult> {
        const data = objs.map(obj => this.stripRelationFields(obj as PlainObject));
        const arg = { data, skipDuplicates: options?.ignoreConflicts };

        return this.execMethod(() => this.getPrismaRepository(options?.db).createMany(arg), "createMany", arg);
    }

    /**
     * Creates multiple records in a single operation, returning the created records.
     */
    async createManyReturning(
        objs: DeepPartial<T>[],
        options?: WithIgnoreConflicts<SimpleAdapterMethodOptions<T>>,
    ): Promise<T[]> {
        const start = this.logger.startPerformLog("run createManyReturning");

        try {
            const data = objs.map(obj => this.stripRelationFields(obj as PlainObject));
            const readArg = this.resolveReadArg(options);
            const arg = { ...readArg, data, skipDuplicates: options?.ignoreConflicts };

            this.logger.logDebug("Resolved Prisma arg for createManyReturning", arg);

            const result = await this.runTransactional(options?.db, async tx => {
                const repo = this.getPrismaRepository(tx);
                const created = await repo.createManyAndReturn({
                    ...arg,
                    include: undefined,
                    select: { [this.pkName]: true },
                });

                const idsCreated = created.map((_: any) => _[this.pkName]);

                return repo.findMany({
                    ...readArg,
                    where: { [this.pkName]: { in: idsCreated } },
                });
            });

            this.logger.endPerformLog(start);

            return result;
        } catch (error) {
            this.logger.endPerformLog(start);

            throw mapPrismaError(error, "createManyReturning");
        }
    }

    /**
     * Fetches the record matching `where` and returns it merged with `obj`,
     * WITHOUT persisting anything. Only the configured `relations` are merged;
     * every other value is replaced. It's on the caller to decide what to do
     * with the result (e.g. call `save` next).
     */
    async merge<K extends DeepPartial<T>>(
        where: VSRepoWhere<T>,
        obj: K,
        options?: SimpleAdapterMethodOptions<T>,
    ): Promise<(K & T) | null> {
        const arg = { ...this.resolveReadArg(options), where: parsePrismaWhere(where) };

        return this.execMethod(
            async () => {
                const result = await this.getPrismaRepository(options?.db).findFirst(arg);
                if (!result) return null;

                return mergeEntities(result, obj as PlainObject, this.relations) as K & T;
            },
            "merge",
            arg,
        );
    }

    /** Creates a record if none matches `where`, otherwise updates it. */
    async upsert(
        where: VSRepoWhere<T>,
        create: DeepPartial<T>,
        update: DeepPartial<T>,
        options?: SimpleAdapterMethodOptions<T>,
    ): Promise<T> {
        const parsedCreate = parsePrismaWriteData(create as PlainObject, this.pkName, this.relations).create;
        const parsedUpdate = parsePrismaWriteData(update as PlainObject, this.pkName, this.relations).update;

        const arg = {
            ...this.resolveReadArg(options),
            where: parsePrismaWhere(where),
            create: parsedCreate,
            update: parsedUpdate,
        };

        return this.execMethod(() => this.getPrismaRepository(options?.db).upsert(arg), "upsert", arg);
    }

    /**
     * Atomically adds `value` to `field` on the record matching `where`,
     * via Prisma's native `{ field: { increment: value } }` write.
     */
    async incrementOne<K extends NumericKeys<T>>(
        field: K,
        value: NonNullable<T[K]>,
        where: VSRepoWhere<T>,
        options?: SimpleAdapterMethodOptions<T>,
    ): Promise<T> {
        return this.atomicUpdate("increment", field, value, where, options);
    }

    /**
     * Atomically subtracts `value` to `field` on the record matching `where`,
     * via Prisma's native `{ field: { decrement: value } }` write.
     */
    async decrementOne<K extends NumericKeys<T>>(
        field: K,
        value: NonNullable<T[K]>,
        where: VSRepoWhere<T>,
        options?: SimpleAdapterMethodOptions<T>,
    ): Promise<T> {
        return this.atomicUpdate("decrement", field, value, where, options);
    }

    /**
     * Atomically multiplies `value` to `field` on the record matching `where`,
     * via Prisma's native `{ field: { multiply: value } }` write.
     */
    async multiplyOne<K extends NumericKeys<T>>(
        field: K,
        value: NonNullable<T[K]>,
        where: VSRepoWhere<T>,
        options?: SimpleAdapterMethodOptions<T>,
    ): Promise<T> {
        return this.atomicUpdate("multiply", field, value, where, options);
    }

    /**
     * Atomically divides `value` to `field` on the record matching `where`,
     * via Prisma's native `{ field: { divide: value } }` write.
     */
    async divideOne<K extends NumericKeys<T>>(
        field: K,
        value: NonNullable<T[K]>,
        where: VSRepoWhere<T>,
        options?: SimpleAdapterMethodOptions<T>,
    ): Promise<T> {
        return this.atomicUpdate("divide", field, value, where, options);
    }

    async incrementMany<K extends NumericKeys<T>>(
        field: K,
        value: NonNullable<T[K]>,
        where: VSRepoWhere<T>,
        options?: RestrictAdapterMethodOptions<T>,
    ): Promise<CountResult> {
        return this.atomicUpdateMany("increment", field, value, where, options);
    }

    async decrementMany<K extends NumericKeys<T>>(
        field: K,
        value: NonNullable<T[K]>,
        where: VSRepoWhere<T>,
        options?: RestrictAdapterMethodOptions<T>,
    ): Promise<CountResult> {
        return this.atomicUpdateMany("decrement", field, value, where, options);
    }

    async multiplyMany<K extends NumericKeys<T>>(
        field: K,
        value: NonNullable<T[K]>,
        where: VSRepoWhere<T>,
        options?: RestrictAdapterMethodOptions<T>,
    ): Promise<CountResult> {
        return this.atomicUpdateMany("multiply", field, value, where, options);
    }

    async divideMany<K extends NumericKeys<T>>(
        field: K,
        value: NonNullable<T[K]>,
        where: VSRepoWhere<T>,
        options?: RestrictAdapterMethodOptions<T>,
    ): Promise<CountResult> {
        return this.atomicUpdateMany("divide", field, value, where, options);
    }

    /**
     * Returns the sum of `field` across every record matching `where` (all
     * records if `where` is empty), or `null` if no record matches.
     */
    async sum(
        field: NumericKeys<T>,
        where?: VSRepoWhere<T>,
        options?: RestrictAdapterMethodOptions<T>,
    ): Promise<number | null> {
        return this.aggregate("sum", field, where, options);
    }

    /** Same as {@link VSRepoPrisma7Adapter.sum}, but the arithmetic mean instead of the total. */
    async average(
        field: NumericKeys<T>,
        where?: VSRepoWhere<T>,
        options?: RestrictAdapterMethodOptions<T>,
    ): Promise<number | null> {
        return this.aggregate("avg", field, where, options);
    }

    /** Same as {@link VSRepoPrisma7Adapter.sum}, but the minimum value instead of the total. */
    async min(
        field: NumericKeys<T>,
        where?: VSRepoWhere<T>,
        options?: RestrictAdapterMethodOptions<T>,
    ): Promise<number | null> {
        return this.aggregate("min", field, where, options);
    }

    /** Same as {@link VSRepoPrisma7Adapter.sum}, but the maximum value instead of the total. */
    async max(
        field: NumericKeys<T>,
        where?: VSRepoWhere<T>,
        options?: RestrictAdapterMethodOptions<T>,
    ): Promise<number | null> {
        return this.aggregate("max", field, where, options);
    }

    /**
     * Returns the model's primary key
     *
     * @publicApi
     */
    override getPkName(): string {
        return this.pkName;
    }

    /**
     * Returns the placeholder corresponding to the index, based on the database dialect.
     *
     * @publicApi
     */
    getPlaceholder(index: number): string {
        switch (this.provider) {
            case "postgresql":
            case "cockroachdb":
                return getPostgresPlaceholder(index);
            case "mysql":
            case "sqlite":
                return getSqlitePlaceholder(index);
            case "sqlserver":
                return getSqlServerPlaceholder(index);
        }
    }
}
