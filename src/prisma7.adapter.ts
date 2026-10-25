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
import { validateAdapterConfig } from "./validators/validate-adapter-config.validator.js";
import { validatePrismaClient } from "./validators/validate-prisma-client.validator.js";
import { AdapterRelations } from "./types/adapter-relations.type.js";
import { VSRepoPrisma7AdapterConfig } from "./types/adapter-config.type.js";
import { PrismaProvider } from "./types/prisma-provider.type.js";
import { PrismaArgLike } from "./types/prisma-arg-like.type.js";
import { PrismaRepositoryLike } from "./types/prisma-repository-like.type.js";
import { PlainObject } from "./types/plain-object.type.js";
import { Prisma7ClientLike } from "./types/prisma7-client-like.type.js";

/**
 * `VSRepoAdapter` implementation for Prisma 7. Translates every method of the
 * adapter contract into Prisma Client calls, resolving `VSRepoWhere`/`Ordering`/
 * `select`/`include` through the parsers, and — when a
 * `relations` config is provided — resolving relation fields on `create`/
 * `update`/`upsert`/`merge` the same way the v1 of VSRepository did (see
 * `Relation`).
 *
 * Every method always rejects with a `VSRepoAdapterError` — any error raised
 * by Prisma (or by the adapter itself) is translated through `mapPrismaError`
 * before leaving the adapter, so callers never have to deal with a raw
 * Prisma/driver error shape.
 *
 * @template T Entity type this adapter operates on.
 *
 * @publicApi
 */
export class VSRepoPrisma7Adapter<T, K extends Prisma7ClientLike = Prisma7ClientLike> extends VSRepoAdapter<T> {
    private readonly tableName: string;
    private readonly pkName: string;
    private readonly relations?: AdapterRelations<T>;
    private readonly logger: VSLogger;
    private readonly provider: PrismaProvider | undefined;

    constructor(
        private readonly prisma: K,
        config: VSRepoPrisma7AdapterConfig<T, K>,
    ) {
        super();

        const validated = validateAdapterConfig<T>(config);

        validatePrismaClient(prisma, validated.tableName);

        this.tableName = validated.tableName;
        this.pkName = validated.pkName as string;
        this.relations = validated.relations;
        this.provider = resolveProvider(prisma, validated.provider);
        this.logger = new VSLogger(validated.logLevel ?? VSLogLevel.WARN, this.constructor.name + "Logger");

        this.logger.logInfo(
            `${this.constructor.name} initialized for table '${this.tableName}' (pkName: '${this.pkName}'${
                this.relations ? `, relations: [${Object.keys(this.relations).join(", ")}]` : ""
            }, provider: ${this.provider ? `'${this.provider}'` : "<not detected>"})`,
        );
    }

    private getPrismaRepository(db?: any): PrismaRepositoryLike {
        return db ? db[this.tableName] : (this.prisma as any)[this.tableName];
    }

    /** Resolves the "read" part of a Prisma arg: select/include/orderBy/pagination. */
    private resolveReadArg(options: (AdapterMethodOptions<T> & { distinct?: (keyof T)[] }) | undefined): PrismaArgLike {
        options ??= {};

        const prismaSelect = options.select && parsePrismaSelect(options.select);
        const prismaInclude = prismaSelect ? undefined : options.relations && parsePrismaInclude(options.relations);

        return {
            select: prismaSelect,
            include: prismaInclude,
            orderBy: parsePrismaOrderBy<T>(options.order),
            skip: options.pagination?.offset,
            take: options.pagination?.limit,
            distinct: options.distinct as any,
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
     * value (which covers a {@link DecimalLike} like `Prisma.Decimal`)
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
        const start = this.logger.startPerformLog(`run ${operation}One`);

        try {
            const arg = {
                ...this.resolveReadArg(options),
                where: parsePrismaWhere<T>(where),
                data: { [field]: { [operation]: value } },
            };
            this.logger.logDebug(`Resolved Prisma arg for '${operation}One'`, arg);

            return await this.getPrismaRepository(options?.db).update(arg);
        } catch (error) {
            throw mapPrismaError(error, `${operation}One`);
        } finally {
            this.logger.endPerformLog(start);
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
        if (typeof (value as Partial<DecimalLike>)?.toNumber === "function") {
            return (value as DecimalLike).toNumber();
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
        where: VSRepoWhere<T>,
        options?: AdapterMethodOptions<T>,
    ): Promise<number | null> {
        const start = this.logger.startPerformLog(`run ${operation}`);
        const aggKey = `_${operation}`;

        try {
            const arg = {
                where: parsePrismaWhere<T>(where) as any,
                [aggKey]: { [field]: true },
            };
            this.logger.logDebug(`Resolved Prisma arg for '${operation}'`, arg);

            const result = await this.getPrismaRepository(options?.db).aggregate(arg);

            return this.toNullableNumber(result?.[aggKey]?.[field as string]);
        } catch (error) {
            throw mapPrismaError(error, operation);
        } finally {
            this.logger.endPerformLog(start);
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

    /** Fetches a single record matching `where`. */
    async findOne(where?: VSRepoWhere<T>, options?: AdapterMethodOptions<T>): Promise<T | null> {
        const start = this.logger.startPerformLog("run findOne");

        try {
            const arg = { ...this.resolveReadArg(options), where: parsePrismaWhere<T>(where) };
            this.logger.logDebug("Resolved Prisma arg for 'findOne'", arg);

            return await this.getPrismaRepository(options?.db).findFirst(arg);
        } catch (error) {
            throw mapPrismaError(error, "findOne");
        } finally {
            this.logger.endPerformLog(start);
        }
    }

    /** Fetches a single record matching `where`, throwing if none is found. */
    async findOneOrThrow(where?: VSRepoWhere<T>, options?: AdapterMethodOptions<T>): Promise<T> {
        const start = this.logger.startPerformLog("run findOneOrThrow");

        try {
            const arg = { ...this.resolveReadArg(options), where: parsePrismaWhere<T>(where) };
            this.logger.logDebug("Resolved Prisma arg for 'findOneOrThrow'", arg);

            return await this.getPrismaRepository(options?.db).findFirstOrThrow(arg);
        } catch (error) {
            throw mapPrismaError(error, "findOneOrThrow");
        } finally {
            this.logger.endPerformLog(start);
        }
    }

    /** Fetches all records matching `where`. */
    async findMany(where?: VSRepoWhere<T>, options?: AdapterMethodOptions<T>): Promise<T[]> {
        const start = this.logger.startPerformLog("run findMany");

        try {
            const arg = { ...this.resolveReadArg(options), where: parsePrismaWhere<T>(where) };
            this.logger.logDebug("Resolved Prisma arg for 'findMany'", arg);

            return await this.getPrismaRepository(options?.db).findMany(arg);
        } catch (error) {
            throw mapPrismaError(error, "findMany");
        } finally {
            this.logger.endPerformLog(start);
        }
    }

    /** Creates or updates (upsert) a single record. */
    async save(obj: DeepPartial<T>, options?: SimpleAdapterMethodOptions<T>): Promise<T> {
        const start = this.logger.startPerformLog("run save");

        try {
            const objAny = obj as PlainObject;
            const pkValue = objAny[this.pkName];
            const readArg = this.resolveReadArg(options);
            const repo = this.getPrismaRepository(options?.db);

            if (pkValue === undefined) {
                const { create } = parsePrismaWriteData(objAny, this.pkName, this.relations);
                const arg = { ...readArg, data: create };
                this.logger.logDebug("Resolved Prisma arg for 'save' (create)", arg);

                return await repo.create(arg);
            }

            const { create, update } = parsePrismaWriteData(objAny, this.pkName, this.relations);
            const arg = { ...readArg, where: { [this.pkName]: pkValue }, create, update };
            this.logger.logDebug("Resolved Prisma arg for 'save' (upsert)", arg);

            return await repo.upsert(arg);
        } catch (error) {
            throw mapPrismaError(error, "save");
        } finally {
            this.logger.endPerformLog(start);
        }
    }

    /**
     * Creates or updates (upsert) multiple records. Prisma has no native bulk
     * upsert, so each record is saved individually inside a transaction —
     * reusing `options.db` when it's already a transaction client (see
     * `runTransactional`).
     */
    async saveMany(objs: DeepPartial<T>[], options?: SimpleAdapterMethodOptions<T>): Promise<T[]> {
        const start = this.logger.startPerformLog("run saveMany");

        try {
            this.logger.logDebug(`Saving ${objs.length} record(s) individually inside a transaction`);

            return await this.runTransactional(options?.db, async tx => {
                const saved: T[] = [];
                for (let i = 0; i < objs.length; i++) {
                    const obj = objs[i]!;
                    saved.push(await this.save(obj, { ...options, db: tx }));
                }
                return saved;
            });
        } catch (error) {
            throw mapPrismaError(error, "saveMany");
        } finally {
            this.logger.endPerformLog(start);
        }
    }

    /** Deletes a single record matching `where`. */
    async delete(where: VSRepoWhere<T>, options?: SimpleAdapterMethodOptions<T>): Promise<T> {
        const start = this.logger.startPerformLog("run delete");

        try {
            const arg = { ...this.resolveReadArg(options), where: parsePrismaWhere<T>(where) };
            this.logger.logDebug("Resolved Prisma arg for 'delete'", arg);

            return await this.getPrismaRepository(options?.db).delete(arg);
        } catch (error) {
            throw mapPrismaError(error, "delete");
        } finally {
            this.logger.endPerformLog(start);
        }
    }

    /** Deletes every record matching `where`, returning the count of affected rows. */
    async deleteMany(where: VSRepoWhere<T>, options?: RestrictAdapterMethodOptions<T>): Promise<CountResult> {
        const start = this.logger.startPerformLog("run deleteMany");

        try {
            const arg = { where: parsePrismaWhere<T>(where) };
            this.logger.logDebug("Resolved Prisma arg for 'deleteMany'", arg);

            return await this.getPrismaRepository(options?.db).deleteMany(arg);
        } catch (error) {
            throw mapPrismaError(error, "deleteMany");
        } finally {
            this.logger.endPerformLog(start);
        }
    }

    /**
     * Deletes every record matching `where`, returning the deleted records.
     *
     * Prisma has no `deleteManyAndReturn`, so this does a `findMany` on
     * `where` first and then re-applies the same `where` to a `deleteMany`,
     * both inside a transaction (`runTransactional`).
     *
     * Because the delete is driven by the same `where` (not by the fetched
     * records), a concurrent change between the two operations can make them
     * diverge — e.g. a row inserted after the `findMany` matching the `where`
     * would still be deleted, while a row changed to stop matching wouldn't.
     * If you need to guarantee no concurrency issues, run this method inside a
     * `repository.transaction()` with a higher isolation level, e.g.
     * `TransactionIsolationLevel.SERIALIZABLE`.
     */
    async deleteManyReturning(where: VSRepoWhere<T>, options?: SimpleAdapterMethodOptions<T>): Promise<T[]> {
        const start = this.logger.startPerformLog("run deleteManyReturning");

        try {
            const prismaWhere = parsePrismaWhere<T>(where);
            const findArg = { ...this.resolveReadArg(options), where: prismaWhere };
            const deleteArg = { where: prismaWhere };
            this.logger.logDebug("Resolved Prisma args for 'deleteManyReturning'", {
                findArg,
                deleteArg,
            });

            return await this.runTransactional(options?.db, async tx => {
                const repo = this.getPrismaRepository(tx);
                const records = await repo.findMany(findArg);
                await repo.deleteMany(deleteArg);
                return records;
            });
        } catch (error) {
            throw mapPrismaError(error, "deleteManyReturning");
        } finally {
            this.logger.endPerformLog(start);
        }
    }

    /** Updates a single record matching `where`. */
    async update(where: VSRepoWhere<T>, obj: DeepPartial<T>, options?: SimpleAdapterMethodOptions<T>): Promise<T> {
        const start = this.logger.startPerformLog("run update");

        try {
            const { update } = parsePrismaWriteData(obj as PlainObject, this.pkName, this.relations);
            const arg = {
                ...this.resolveReadArg(options),
                where: parsePrismaWhere<T>(where),
                data: update,
            };
            this.logger.logDebug("Resolved Prisma arg for 'update'", arg);

            return await this.getPrismaRepository(options?.db).update(arg);
        } catch (error) {
            throw mapPrismaError(error, "update");
        } finally {
            this.logger.endPerformLog(start);
        }
    }

    /** Updates every record matching `where`, returning the count of affected rows. */
    async updateMany(
        where: VSRepoWhere<T>,
        obj: DeepPartial<T>,
        options?: RestrictAdapterMethodOptions<T>,
    ): Promise<CountResult> {
        const start = this.logger.startPerformLog("run updateMany");

        try {
            const data = this.stripRelationFields(obj as PlainObject);
            const arg = { where: parsePrismaWhere<T>(where), data };
            this.logger.logDebug("Resolved Prisma arg for 'updateMany'", arg);

            return await this.getPrismaRepository(options?.db).updateMany(arg);
        } catch (error) {
            throw mapPrismaError(error, "updateMany");
        } finally {
            this.logger.endPerformLog(start);
        }
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
                where: parsePrismaWhere<T>(where),
                data,
            };
            this.logger.logDebug("Resolved Prisma arg for 'updateManyReturning'", arg);

            return await this.runTransactional(options?.db, async tx => {
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
        } catch (error) {
            throw mapPrismaError(error, "updateManyReturning");
        } finally {
            this.logger.endPerformLog(start);
        }
    }

    /** Returns the number of records matching `where`. */
    async count(where?: VSRepoWhere<T>, options?: RestrictAdapterMethodOptions<T>): Promise<number> {
        const start = this.logger.startPerformLog("run count");

        try {
            const readArg = this.resolveReadArg(options);
            const arg = { ...readArg, where: parsePrismaWhere<T>(where) };
            this.logger.logDebug("Resolved Prisma arg for 'count'", arg);

            return await this.getPrismaRepository(options?.db).count(arg);
        } catch (error) {
            throw mapPrismaError(error, "count");
        } finally {
            this.logger.endPerformLog(start);
        }
    }

    /** Checks whether at least one record matching `where` exists. */
    async exists(where?: VSRepoWhere<T>, options?: RestrictAdapterMethodOptions<T>): Promise<boolean> {
        const start = this.logger.startPerformLog("run exists");

        try {
            const arg = { where: parsePrismaWhere<T>(where), select: { [this.pkName]: true } };
            this.logger.logDebug("Resolved Prisma arg for 'exists'", arg);

            const result = await this.getPrismaRepository(options?.db).findFirst(arg);
            return result !== null;
        } catch (error) {
            throw mapPrismaError(error, "exists");
        } finally {
            this.logger.endPerformLog(start);
        }
    }

    /** Executes a raw query/statement against the underlying database, used by `@QueryMethod`. */
    async query<R = any>(query: string, options?: AdapterQueryOptions): Promise<R> {
        const modifying = options?.modifying ?? false;
        const db = options?.db ?? this.prisma;
        const args = options?.args ?? [];

        const start = this.logger.startPerformLog(`run raw query (modifying: ${modifying})`);

        try {
            this.logger.logDebug("Running raw query", { query, args, modifying });

            return modifying ? await db.$executeRawUnsafe(query, ...args) : await db.$queryRawUnsafe(query, ...args);
        } catch (error) {
            throw mapPrismaError(error, "query");
        } finally {
            this.logger.endPerformLog(start);
        }
    }

    /** Creates a single record. */
    async create(obj: DeepPartial<T>, options?: SimpleAdapterMethodOptions<T>): Promise<T> {
        const start = this.logger.startPerformLog("run create");

        try {
            const { create } = parsePrismaWriteData(obj as PlainObject, this.pkName, this.relations);
            const arg = { ...this.resolveReadArg(options), data: create };
            this.logger.logDebug("Resolved Prisma arg for 'create'", arg);

            return await this.getPrismaRepository(options?.db).create(arg);
        } catch (error) {
            throw mapPrismaError(error, "create");
        } finally {
            this.logger.endPerformLog(start);
        }
    }

    /**
     * Creates multiple records in a single operation. Relation fields are
     * stripped (see `stripRelationFields`), since Prisma's `createMany` doesn't
     * support nested writes.
     */
    async createMany(
        objs: DeepPartial<T>[],
        options?: WithIgnoreConflicts<RestrictAdapterMethodOptions<T>>,
    ): Promise<CountResult> {
        const start = this.logger.startPerformLog("run createMany");

        try {
            const data = objs.map(obj => this.stripRelationFields(obj as PlainObject));
            const arg = { data, skipDuplicates: options?.ignoreConflicts };
            this.logger.logDebug("Resolved Prisma arg for 'createMany'", arg);

            return await this.getPrismaRepository(options?.db).createMany(arg);
        } catch (error) {
            throw mapPrismaError(error, "createMany");
        } finally {
            this.logger.endPerformLog(start);
        }
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
            const arg = { data, skipDuplicates: options?.ignoreConflicts };
            this.logger.logDebug("Resolved Prisma arg for 'createManyReturning'", arg);

            return await this.runTransactional(options?.db, async tx => {
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
        } catch (error) {
            throw mapPrismaError(error, "createManyReturning");
        } finally {
            this.logger.endPerformLog(start);
        }
    }

    /**
     * Fetches the record matching `where` and returns it deep-merged with
     * `obj`, WITHOUT persisting anything — same behavior the v1 of
     * VSRepository had (see `mergeEntities`). It's on the caller to decide
     * what to do with the result (e.g. call `save` next).
     */
    async merge<K extends DeepPartial<T>>(
        where: VSRepoWhere<T>,
        obj: K,
        options?: SimpleAdapterMethodOptions<T>,
    ): Promise<(K & T) | null> {
        const start = this.logger.startPerformLog("run merge");

        try {
            const arg = { ...this.resolveReadArg(options), where: parsePrismaWhere<T>(where) };
            this.logger.logDebug("Resolved Prisma arg for 'merge'", arg);

            const result = await this.getPrismaRepository(options?.db).findFirst(arg);
            if (!result) return null;

            return mergeEntities(result, obj as PlainObject, this.relations) as K & T;
        } catch (error) {
            throw mapPrismaError(error, "merge");
        } finally {
            this.logger.endPerformLog(start);
        }
    }

    /** Creates a record if none matches `where`, otherwise updates it. */
    async upsert(
        where: VSRepoWhere<T>,
        create: DeepPartial<T>,
        update: DeepPartial<T>,
        options?: SimpleAdapterMethodOptions<T>,
    ): Promise<T> {
        const start = this.logger.startPerformLog("run upsert");

        try {
            const parsedCreate = parsePrismaWriteData(create as PlainObject, this.pkName, this.relations).create;

            const parsedUpdate = parsePrismaWriteData(update as PlainObject, this.pkName, this.relations).update;

            const arg = {
                ...this.resolveReadArg(options),
                where: parsePrismaWhere<T>(where),
                create: parsedCreate,
                update: parsedUpdate,
            };
            this.logger.logDebug("Resolved Prisma arg for 'upsert'", arg);

            return await this.getPrismaRepository(options?.db).upsert(arg);
        } catch (error) {
            throw mapPrismaError(error, "upsert");
        } finally {
            this.logger.endPerformLog(start);
        }
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

    /** Same as {@link VSRepoPrisma7Adapter.incrementOne}, subtracting `value` instead of adding it. */
    async decrementOne<K extends NumericKeys<T>>(
        field: K,
        value: NonNullable<T[K]>,
        where: VSRepoWhere<T>,
        options?: SimpleAdapterMethodOptions<T>,
    ): Promise<T> {
        return this.atomicUpdate("decrement", field, value, where, options);
    }

    /** Same as {@link VSRepoPrisma7Adapter.incrementOne}, multiplying the field's current value by `value`. */
    async multiplyOne<K extends NumericKeys<T>>(
        field: K,
        value: NonNullable<T[K]>,
        where: VSRepoWhere<T>,
        options?: SimpleAdapterMethodOptions<T>,
    ): Promise<T> {
        return this.atomicUpdate("multiply", field, value, where, options);
    }

    /**
     * Same as {@link VSRepoPrisma7Adapter.incrementOne}, dividing the
     * field's current value by `value`. Division-by-zero is not handled by
     * the adapter — it's whatever Postgres does natively (raises a
     * `division_by_zero` error for integer columns; `Infinity`/`NaN` are not
     * representable in a numeric/decimal column, so those also error).
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
        throw new Error("Method not implemented.");
    }

    async decrementMany<K extends NumericKeys<T>>(
        field: K,
        value: NonNullable<T[K]>,
        where: VSRepoWhere<T>,
        options?: RestrictAdapterMethodOptions<T>,
    ): Promise<CountResult> {
        throw new Error("Method not implemented.");
    }

    async multiplyMany<K extends NumericKeys<T>>(
        field: K,
        value: NonNullable<T[K]>,
        where: VSRepoWhere<T>,
        options?: RestrictAdapterMethodOptions<T>,
    ): Promise<CountResult> {
        throw new Error("Method not implemented.");
    }

    async divideMany<K extends NumericKeys<T>>(
        field: K,
        value: NonNullable<T[K]>,
        where: VSRepoWhere<T>,
        options?: RestrictAdapterMethodOptions<T>,
    ): Promise<CountResult> {
        throw new Error("Method not implemented.");
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
        return this.aggregate("sum", field, where ?? {}, options);
    }

    /** Same as {@link VSRepoPrisma7Adapter.sum}, but the arithmetic mean instead of the total. */
    async average(
        field: NumericKeys<T>,
        where?: VSRepoWhere<T>,
        options?: RestrictAdapterMethodOptions<T>,
    ): Promise<number | null> {
        return this.aggregate("avg", field, where ?? {}, options);
    }

    /** Same as {@link VSRepoPrisma7Adapter.sum}, but the minimum value instead of the total. */
    async min(
        field: NumericKeys<T>,
        where?: VSRepoWhere<T>,
        options?: RestrictAdapterMethodOptions<T>,
    ): Promise<number | null> {
        return this.aggregate("min", field, where ?? {}, options);
    }

    /** Same as {@link VSRepoPrisma7Adapter.sum}, but the maximum value instead of the total. */
    async max(
        field: NumericKeys<T>,
        where?: VSRepoWhere<T>,
        options?: RestrictAdapterMethodOptions<T>,
    ): Promise<number | null> {
        return this.aggregate("max", field, where ?? {}, options);
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
            default:
                throw new VSRepoAdapterError(
                    "Cannot resolve the raw-query placeholder syntax: the Prisma provider couldn't be detected from the client, " +
                        "and no 'provider' was set in the adapter config. Set 'provider' in the VSRepoPrisma7Adapter config (one of: " +
                        "postgresql, cockroachdb, mysql, sqlite, sqlserver) to enable raw-query placeholder compilation " +
                        "(e.g. VSSql fragments and 'vsPlaceholders').",
                    AdapterErrorCode.NOT_SUPPORTED,
                    null,
                );
        }
    }
}
