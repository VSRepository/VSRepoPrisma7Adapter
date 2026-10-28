import { AdapterErrorCode, VSRepoAdapterError, VSLogLevel } from "vsrepo";
import { VSRepoPrisma7Adapter } from "./prisma7.adapter.js";

interface Address {
    id: string;
    street: string;
}

interface Post {
    id: string;
    title: string;
}

interface User {
    id: string;
    name: string;
    email: string;
    age: number;
    score: number;
    address: Address | null;
    posts: Post[];
}

const DELEGATE_METHODS = [
    "findFirst",
    "findFirstOrThrow",
    "findMany",
    "create",
    "createMany",
    "createManyAndReturn",
    "update",
    "updateMany",
    "updateManyAndReturn",
    "upsert",
    "delete",
    "deleteMany",
    "count",
    "aggregate",
] as const;

function createDelegate(): Record<(typeof DELEGATE_METHODS)[number], ReturnType<typeof vi.fn>> {
    const delegate: any = {};
    for (const method of DELEGATE_METHODS) delegate[method] = vi.fn();
    return delegate;
}

class Decimal {
    constructor(public readonly value: number) {}
    toNumber() {
        return this.value;
    }
    toFixed(dp?: number) {
        return this.value.toFixed(dp);
    }
    toString() {
        return String(this.value);
    }
    decimalPlaces() {
        return 2;
    }
}

function prismaError(name: string, extra: Record<string, unknown> = {}): Error {
    const error = new Error(`${name} message`);
    error.name = name;
    return Object.assign(error, extra);
}

const relationsConfig = {
    address: { mode: "mto", restriction: "add", pk: "id" },
    posts: { mode: "otm", restriction: "add", pk: "id" },
} as any;

/**
 * Builds the adapter on top of a fake Prisma Client: the root client exposes `$on`
 * (like the real one) and a `$transaction` that hands `tx` (which does NOT expose
 * `$on`, like Prisma's interactive transaction client) to the callback.
 */
function setup(config: Record<string, unknown> = {}, prismaOverrides: Record<string, unknown> = {}) {
    const user = createDelegate();
    const txUser = createDelegate();
    const tx: any = { user: txUser };

    const prisma: any = {
        user,
        $on: vi.fn(),
        $executeRaw: vi.fn(),
        $executeRawUnsafe: vi.fn(),
        $queryRaw: vi.fn(),
        $queryRawUnsafe: vi.fn(),
        $transaction: vi.fn(async (fn: (tx: any) => Promise<unknown>) => fn(tx)),
        _engineConfig: { activeProvider: "postgresql" },
        ...prismaOverrides,
    };

    const adapter = new VSRepoPrisma7Adapter<User>(prisma, {
        modelName: "user",
        pkName: "id",
        logLevel: VSLogLevel.NONE,
        ...config,
    } as any);

    return { adapter, prisma, user, tx, txUser };
}

const where = { name: { contains: "jo", ignoreCase: true } };

describe("VSRepoPrisma7Adapter", () => {
    describe("constructor", () => {
        it("should throw MISSING_DB_CLIENT when the prisma client is null", () => {
            const create = () =>
                new VSRepoPrisma7Adapter<User>(null as any, { modelName: "user", pkName: "id" } as any);

            expect(create).toThrow(VSRepoAdapterError);
            expect(create).toThrow(expect.objectContaining({ code: AdapterErrorCode.MISSING_DB_CLIENT }));
        });

        it("should throw MODEL_NOT_FOUND when the model delegate does not exist", () => {
            const create = () => setup({ modelName: "unknown" });

            expect(create).toThrow(VSRepoAdapterError);
            expect(create).toThrow(expect.objectContaining({ code: AdapterErrorCode.MODEL_NOT_FOUND }));
        });

        it("should throw NOT_SUPPORTED when the provider cannot be detected nor was configured", () => {
            const create = () => setup({}, { _engineConfig: undefined });

            expect(create).toThrow(VSRepoAdapterError);
            expect(create).toThrow(expect.objectContaining({ code: AdapterErrorCode.NOT_SUPPORTED }));
        });

        it("should accept an explicit provider when it cannot be detected", () => {
            const { adapter } = setup({ provider: "mysql" }, { _engineConfig: undefined });

            expect(adapter.getPlaceholder(0)).toBe("?");
        });
    });

    describe("simple accessors", () => {
        it("should return the configured pk name", () => {
            const { adapter } = setup({ pkName: "email" });

            expect(adapter.getPkName()).toBe("email");
        });

        it("should return the underlying prisma client", () => {
            const { adapter, prisma } = setup();

            expect(adapter.getDbClient()).toBe(prisma);
        });
    });

    describe("getPlaceholder", () => {
        it.each([
            ["postgresql", 0, "$1"],
            ["postgresql", 2, "$3"],
            ["cockroachdb", 1, "$2"],
            ["mysql", 0, "?"],
            ["mysql", 3, "?"],
            ["sqlite", 5, "?"],
            ["sqlserver", 0, "@P1"],
            ["sqlserver", 2, "@P3"],
        ] as const)("should resolve '%s' at index %i to '%s'", (provider, index, expected) => {
            const { adapter } = setup({ provider });

            expect(adapter.getPlaceholder(index)).toBe(expected);
        });

        it("should detect the provider from _engineConfig.activeProvider", () => {
            const { adapter } = setup({}, { _engineConfig: { activeProvider: "sqlserver" } });

            expect(adapter.getPlaceholder(0)).toBe("@P1");
        });

        it("should detect the provider from the driver adapter as a fallback", () => {
            const { adapter } = setup({}, { _engineConfig: { adapter: { provider: "sqlite" } } });

            expect(adapter.getPlaceholder(0)).toBe("?");
        });

        it("should prefer the configured provider over the detected one", () => {
            const { adapter } = setup({ provider: "sqlserver" });

            expect(adapter.getPlaceholder(0)).toBe("@P1");
        });
    });

    describe("findOne / findOneOrThrow / findMany", () => {
        it("should call findFirst with the parsed where and return the result", async () => {
            const { adapter, user } = setup();
            user.findFirst!.mockResolvedValue({ id: "1" });

            const result = await adapter.findOne({ name: { contains: "jo", ignoreCase: true } });

            expect(result).toEqual({ id: "1" });
            expect(user.findFirst).toHaveBeenCalledWith({
                where: { name: { contains: "jo", mode: "insensitive" } },
            });
        });

        it("should return null when findFirst finds nothing", async () => {
            const { adapter, user } = setup();
            user.findFirst!.mockResolvedValue(null);

            await expect(adapter.findOne({ id: "x" })).resolves.toBeNull();
        });

        it("should call findFirstOrThrow for findOneOrThrow", async () => {
            const { adapter, user } = setup();
            user.findFirstOrThrow!.mockResolvedValue({ id: "1" });

            const result = await adapter.findOneOrThrow({ id: "1" });

            expect(result).toEqual({ id: "1" });
            expect(user.findFirstOrThrow).toHaveBeenCalledWith({ where: { id: "1" } });
        });

        it("should map a P2025 error from findOneOrThrow to NOT_FOUND", async () => {
            const { adapter, user } = setup();
            user.findFirstOrThrow!.mockRejectedValue(prismaError("PrismaClientKnownRequestError", { code: "P2025" }));

            await expect(adapter.findOneOrThrow({ id: "1" })).rejects.toMatchObject({
                code: AdapterErrorCode.NOT_FOUND,
            });
        });

        it("should call findMany with the parsed where", async () => {
            const { adapter, user } = setup();
            user.findMany!.mockResolvedValue([{ id: "1" }, { id: "2" }]);

            const result = await adapter.findMany({ OR: [{ id: "1" }, { id: "2" }] });

            expect(result).toHaveLength(2);
            expect(user.findMany).toHaveBeenCalledWith({ where: { OR: [{ id: "1" }, { id: "2" }] } });
        });

        it("should accept an undefined where", async () => {
            const { adapter, user } = setup();
            user.findMany!.mockResolvedValue([]);

            await adapter.findMany();

            expect(user.findMany).toHaveBeenCalledWith({ where: undefined });
        });

        it("should translate select, order and pagination options", async () => {
            const { adapter, user } = setup();
            user.findMany!.mockResolvedValue([]);

            await adapter.findMany({ age: { gt: 18 } }, {
                select: { id: true, name: true },
                order: { name: "ASC" },
                pagination: { offset: 10, limit: 5 },
            } as any);

            expect(user.findMany).toHaveBeenCalledWith({
                where: { age: { gt: 18 } },
                select: { id: true, name: true },
                orderBy: { name: "asc" },
                skip: 10,
                take: 5,
            });
        });

        it("should translate relations into include", async () => {
            const { adapter, user } = setup();
            user.findMany!.mockResolvedValue([]);

            await adapter.findMany({}, { relations: { posts: true, address: true } } as any);

            expect(user.findMany).toHaveBeenCalledWith({
                where: {},
                include: { posts: true, address: true },
            });
        });

        it("should ignore relations when select is provided", async () => {
            const { adapter, user } = setup();
            user.findMany!.mockResolvedValue([]);

            await adapter.findMany({}, { select: { id: true }, relations: { posts: true } } as any);

            const arg = user.findMany!.mock.calls[0]![0];
            expect(arg.select).toEqual({ id: true });
            expect(arg.include).toBeUndefined();
        });

        it("should use options.db instead of the root client", async () => {
            const { adapter, user, txUser, tx } = setup();
            txUser.findFirst!.mockResolvedValue({ id: "1" });

            const result = await adapter.findOne({ id: "1" }, { db: tx });

            expect(result).toEqual({ id: "1" });
            expect(txUser.findFirst).toHaveBeenCalledTimes(1);
            expect(user.findFirst).not.toHaveBeenCalled();
        });

        it("should reject with a VSRepoAdapterError when the where uses an unsupported operator", async () => {
            const { adapter, user } = setup();

            await expect(adapter.findMany({ name: { like: "jo%" } })).rejects.toMatchObject({
                code: AdapterErrorCode.NOT_SUPPORTED,
            });
            expect(user.findMany).not.toHaveBeenCalled();
        });

        describe("ignoreCase", () => {
            it.each(["postgresql", "cockroachdb"] as const)("should translate ignoreCase on %s", async provider => {
                const { adapter, user } = setup({ provider });
                user.findMany!.mockResolvedValue([]);

                await adapter.findMany({ name: { contains: "jo", ignoreCase: true } });

                expect(user.findMany).toHaveBeenCalledWith({
                    where: { name: { contains: "jo", mode: "insensitive" } },
                });
            });

            it.each(["mysql", "sqlite", "sqlserver"] as const)(
                "should reject ignoreCase on %s with NOT_SUPPORTED before touching the database",
                async provider => {
                    const { adapter, user } = setup({ provider });

                    await expect(
                        adapter.findMany({ name: { contains: "jo", ignoreCase: true } }),
                    ).rejects.toMatchObject({ code: AdapterErrorCode.NOT_SUPPORTED });
                    expect(user.findMany).not.toHaveBeenCalled();
                },
            );

            it("should keep working on providers without insensitive mode when ignoreCase is not used", async () => {
                const { adapter, user } = setup({ provider: "mysql" });
                user.findMany!.mockResolvedValue([]);

                await adapter.findMany({ name: { contains: "jo", ignoreCase: false } });

                expect(user.findMany).toHaveBeenCalledWith({ where: { name: { contains: "jo" } } });
            });

            it.each([
                ["findOne", (a: any) => a.findOne(where)],
                ["findOneOrThrow", (a: any) => a.findOneOrThrow(where)],
                ["count", (a: any) => a.count(where)],
                ["exists", (a: any) => a.exists(where)],
                ["merge", (a: any) => a.merge(where, { name: "x" })],
                ["update", (a: any) => a.update(where, { name: "x" })],
                ["updateMany", (a: any) => a.updateMany(where, { name: "x" })],
                ["updateManyReturning", (a: any) => a.updateManyReturning(where, { name: "x" })],
                ["delete", (a: any) => a.delete(where)],
                ["deleteMany", (a: any) => a.deleteMany(where)],
                ["deleteManyReturning", (a: any) => a.deleteManyReturning(where)],
                ["incrementOne", (a: any) => a.incrementOne("age", 1, where)],
                ["incrementMany", (a: any) => a.incrementMany("age", 1, where)],
                ["sum", (a: any) => a.sum("age", where)],
            ])("should be enforced by %s", async (_method, run) => {
                const { adapter, user, txUser } = setup({ provider: "sqlite" });

                await expect(run(adapter)).rejects.toMatchObject({ code: AdapterErrorCode.NOT_SUPPORTED });

                for (const delegate of [user, txUser]) {
                    for (const fn of Object.values(delegate)) expect(fn).not.toHaveBeenCalled();
                }
            });
        });

        it("should wrap unknown errors in a VSRepoAdapterError", async () => {
            const { adapter, user } = setup();
            const original = new Error("boom");
            user.findMany!.mockRejectedValue(original);

            const error = await adapter.findMany().catch(e => e);

            expect(error).toBeInstanceOf(VSRepoAdapterError);
            expect(error.code).toBe(AdapterErrorCode.UNKNOWN);
            expect(error.originalError).toBe(original);
        });
    });

    describe("create", () => {
        it("should call create with the data", async () => {
            const { adapter, user } = setup();
            user.create!.mockResolvedValue({ id: "1", name: "John" });

            const result = await adapter.create({ name: "John" });

            expect(result).toEqual({ id: "1", name: "John" });
            expect(user.create).toHaveBeenCalledWith({ data: { name: "John" } });
        });

        it("should resolve relations into nested writes", async () => {
            const { adapter, user } = setup({ relations: relationsConfig });
            user.create!.mockResolvedValue({});

            await adapter.create({ name: "John", posts: [{ title: "A" }, { id: "9", title: "B" }] } as any);

            expect(user.create).toHaveBeenCalledWith({
                data: {
                    name: "John",
                    posts: {
                        create: [{ title: "A" }],
                        connectOrCreate: [{ where: { id: "9" }, create: { id: "9", title: "B" } }],
                    },
                },
            });
        });

        it("should apply the read options", async () => {
            const { adapter, user } = setup();
            user.create!.mockResolvedValue({});

            await adapter.create({ name: "John" }, { select: { id: true } } as any);

            expect(user.create).toHaveBeenCalledWith({ data: { name: "John" }, select: { id: true } });
        });

        it("should map a unique constraint error", async () => {
            const { adapter, user } = setup();
            user.create!.mockRejectedValue(prismaError("PrismaClientKnownRequestError", { code: "P2002" }));

            await expect(adapter.create({ email: "a@a.com" })).rejects.toMatchObject({
                code: AdapterErrorCode.UNIQUE_CONSTRAINT_VIOLATION,
            });
        });
    });

    describe("save", () => {
        it("should create when the pk is not provided", async () => {
            const { adapter, user } = setup();
            user.create!.mockResolvedValue({ id: "1", name: "John" });

            const result = await adapter.save({ name: "John" });

            expect(result).toEqual({ id: "1", name: "John" });
            expect(user.create).toHaveBeenCalledWith({ data: { name: "John" } });
            expect(user.upsert).not.toHaveBeenCalled();
        });

        it("should upsert by pk (omitting the pk from the update) when the pk is provided", async () => {
            const { adapter, user } = setup();
            user.upsert!.mockResolvedValue({ id: "1", name: "John" });

            await adapter.save({ id: "1", name: "John" });

            expect(user.upsert).toHaveBeenCalledWith({
                where: { id: "1" },
                create: { id: "1", name: "John" },
                update: { name: "John" },
            });
            expect(user.create).not.toHaveBeenCalled();
        });

        it("should use the configured pkName", async () => {
            const { adapter, user } = setup({ pkName: "email" });
            user.upsert!.mockResolvedValue({});

            await adapter.save({ email: "a@a.com", name: "John" });

            expect(user.upsert).toHaveBeenCalledWith({
                where: { email: "a@a.com" },
                create: { email: "a@a.com", name: "John" },
                update: { name: "John" },
            });
        });

        it("should resolve relations on create and on update", async () => {
            const { adapter, user } = setup({ relations: relationsConfig });
            user.upsert!.mockResolvedValue({});

            await adapter.save({ id: "1", address: { id: "10", street: "Rua A" } } as any);

            const address = { id: "10", street: "Rua A" };
            expect(user.upsert).toHaveBeenCalledWith({
                where: { id: "1" },
                create: { id: "1", address: { connectOrCreate: { where: { id: "10" }, create: address } } },
                update: { address: { connectOrCreate: { where: { id: "10" }, create: address } } },
            });
        });

        it("should apply the read options and use options.db", async () => {
            const { adapter, user, txUser, tx } = setup();
            txUser.create!.mockResolvedValue({});

            await adapter.save({ name: "John" }, { db: tx, select: { id: true } } as any);

            expect(txUser.create).toHaveBeenCalledWith({ data: { name: "John" }, select: { id: true } });
            expect(user.create).not.toHaveBeenCalled();
        });

        it("should map errors", async () => {
            const { adapter, user } = setup();
            user.upsert!.mockRejectedValue(prismaError("PrismaClientKnownRequestError", { code: "P2003" }));

            await expect(adapter.save({ id: "1" })).rejects.toMatchObject({
                code: AdapterErrorCode.FOREIGN_KEY_VIOLATION,
            });
        });
    });

    describe("saveMany", () => {
        it("should save every record inside a new transaction", async () => {
            const { adapter, prisma, user, txUser } = setup();
            txUser.create!.mockResolvedValueOnce({ id: "1" });
            txUser.upsert!.mockResolvedValueOnce({ id: "2" });

            const result = await adapter.saveMany([{ name: "John" }, { id: "2", name: "Jane" }]);

            expect(result).toEqual([{ id: "1" }, { id: "2" }]);
            expect(prisma.$transaction).toHaveBeenCalledTimes(1);
            expect(txUser.create).toHaveBeenCalledWith({ data: { name: "John" } });
            expect(txUser.upsert).toHaveBeenCalledWith({
                where: { id: "2" },
                create: { id: "2", name: "Jane" },
                update: { name: "Jane" },
            });
            expect(user.create).not.toHaveBeenCalled();
            expect(user.upsert).not.toHaveBeenCalled();
        });

        it("should return an empty array for an empty input", async () => {
            const { adapter } = setup();

            await expect(adapter.saveMany([])).resolves.toEqual([]);
        });

        it("should reuse an active transaction client instead of opening a new transaction", async () => {
            const { adapter, prisma, txUser, tx } = setup();
            txUser.create!.mockResolvedValue({ id: "1" });

            await adapter.saveMany([{ name: "John" }], { db: tx });

            expect(prisma.$transaction).not.toHaveBeenCalled();
            expect(txUser.create).toHaveBeenCalledTimes(1);
        });

        it("should open a new transaction when options.db is a root client", async () => {
            const { adapter, prisma, tx, txUser } = setup();
            const otherRoot: any = {
                user: createDelegate(),
                $on: vi.fn(),
                $transaction: vi.fn(async (fn: any) => fn(tx)),
            };
            txUser.create!.mockResolvedValue({ id: "1" });

            await adapter.saveMany([{ name: "John" }], { db: otherRoot });

            expect(otherRoot.$transaction).toHaveBeenCalledTimes(1);
            expect(prisma.$transaction).not.toHaveBeenCalled();
        });

        it("should map errors raised while saving", async () => {
            const { adapter, txUser } = setup();
            txUser.create!.mockRejectedValue(prismaError("PrismaClientKnownRequestError", { code: "P2002" }));

            await expect(adapter.saveMany([{ name: "John" }])).rejects.toMatchObject({
                code: AdapterErrorCode.UNIQUE_CONSTRAINT_VIOLATION,
            });
        });
    });

    describe("upsert", () => {
        it("should call prisma upsert with parsed where, create and update", async () => {
            const { adapter, user } = setup();
            user.upsert!.mockResolvedValue({ id: "1" });

            const result = await adapter.upsert(
                { email: "a@a.com" },
                { email: "a@a.com", name: "John" },
                { name: "Jane" },
            );

            expect(result).toEqual({ id: "1" });
            expect(user.upsert).toHaveBeenCalledWith({
                where: { email: "a@a.com" },
                create: { email: "a@a.com", name: "John" },
                update: { name: "Jane" },
            });
        });

        it("should resolve relations separately for create and update", async () => {
            const { adapter, user } = setup({ relations: relationsConfig });
            user.upsert!.mockResolvedValue({});

            await adapter.upsert({ id: "1" }, { posts: [{ title: "A" }] } as any, { posts: [{ title: "B" }] } as any);

            const arg = user.upsert!.mock.calls[0]![0];
            expect(arg.create).toEqual({ posts: { create: [{ title: "A" }], connectOrCreate: [] } });
            expect(arg.update).toEqual({ posts: { create: [{ title: "B" }], upsert: [] } });
        });
    });

    describe("update", () => {
        it("should call prisma update with the parsed where and data", async () => {
            const { adapter, user } = setup();
            user.update!.mockResolvedValue({ id: "1", name: "Jane" });

            const result = await adapter.update({ id: "1" }, { name: "Jane" });

            expect(result).toEqual({ id: "1", name: "Jane" });
            expect(user.update).toHaveBeenCalledWith({ where: { id: "1" }, data: { name: "Jane" } });
        });

        it("should resolve relations using the update strategy", async () => {
            const { adapter, user } = setup({ relations: relationsConfig });
            user.update!.mockResolvedValue({});
            const address = { id: "10", street: "Rua A" };

            await adapter.update({ id: "1" }, { address, posts: [{ title: "A" }] } as any);

            expect(user.update).toHaveBeenCalledWith({
                where: { id: "1" },
                data: {
                    address: { connectOrCreate: { where: { id: "10" }, create: address } },
                    posts: { create: [{ title: "A" }], upsert: [] },
                },
            });
        });

        it("should reject when a non-nullable to-one relation is set to null", async () => {
            const { adapter, user } = setup({ relations: relationsConfig });

            await expect(adapter.update({ id: "1" }, { address: null } as any)).rejects.toMatchObject({
                code: AdapterErrorCode.INVALID_DATA,
            });
            expect(user.update).not.toHaveBeenCalled();
        });

        it("should map P2025 to NOT_FOUND", async () => {
            const { adapter, user } = setup();
            user.update!.mockRejectedValue(prismaError("PrismaClientKnownRequestError", { code: "P2025" }));

            await expect(adapter.update({ id: "1" }, { name: "x" })).rejects.toMatchObject({
                code: AdapterErrorCode.NOT_FOUND,
            });
        });
    });

    describe("updateMany", () => {
        it("should call updateMany with the parsed where and data", async () => {
            const { adapter, user } = setup();
            user.updateMany!.mockResolvedValue({ count: 3 });

            const result = await adapter.updateMany({ age: { lt: 18 } }, { name: "Minor" });

            expect(result).toEqual({ count: 3 });
            expect(user.updateMany).toHaveBeenCalledWith({ where: { age: { lt: 18 } }, data: { name: "Minor" } });
        });

        it("should drop undefined fields when relations are configured", async () => {
            const { adapter, user } = setup({ relations: relationsConfig });
            user.updateMany!.mockResolvedValue({ count: 1 });

            await adapter.updateMany({ id: "1" }, { name: "Jane", email: undefined });

            expect(user.updateMany).toHaveBeenCalledWith({ where: { id: "1" }, data: { name: "Jane" } });
        });

        it("should reject with NOT_SUPPORTED when the payload has a configured relation field", async () => {
            const { adapter, user } = setup({ relations: relationsConfig });

            const error = await adapter.updateMany({ id: "1" }, { posts: [{ title: "A" }] } as any).catch(e => e);

            expect(error).toBeInstanceOf(VSRepoAdapterError);
            expect(error.code).toBe(AdapterErrorCode.NOT_SUPPORTED);
            expect(error.message).toContain("'posts'");
            expect(user.updateMany).not.toHaveBeenCalled();
        });
    });

    describe("updateManyReturning", () => {
        it("should update inside a transaction and re-read the updated records", async () => {
            const { adapter, prisma, user, txUser } = setup();
            user.updateManyAndReturn!.mockResolvedValue([{ id: "1" }, { id: "2" }]);
            user.findMany!.mockResolvedValue([
                { id: "1", name: "X" },
                { id: "2", name: "X" },
            ]);

            const result = await adapter.updateManyReturning({ age: { gt: 18 } }, { name: "X" });

            expect(result).toHaveLength(2);
            expect(prisma.$transaction).toHaveBeenCalledTimes(0);
            expect(user.updateManyAndReturn).toHaveBeenCalledWith({
                where: { age: { gt: 18 } },
                data: { name: "X" },
            });
            expect(txUser.updateManyAndReturn).not.toHaveBeenCalled();
            expect(txUser.findMany).not.toHaveBeenCalled();
        });

        it("should pass the read options to the final re-read, not to the update", async () => {
            const { adapter, txUser } = setup();
            txUser.updateManyAndReturn!.mockResolvedValue([{ id: "1" }]);
            txUser.findMany!.mockResolvedValue([]);

            await adapter.updateManyReturning(
                {},
                { name: "X" },
                {
                    relations: { posts: true },
                },
            );

            const updateArg = txUser.updateManyAndReturn!.mock.calls[0]![0];
            expect(updateArg).toEqual({ where: {}, data: { name: "X" }, select: { id: true } });
            for (const key of ["include", "orderBy", "skip", "take"]) {
                expect(updateArg).not.toHaveProperty(key);
            }

            expect(txUser.findMany).toHaveBeenCalledWith({
                include: { posts: true },
                where: { id: { in: ["1"] } },
            });
        });

        it.each(["mysql", "sqlserver"] as const)(
            "should reject with NOT_SUPPORTED on %s without opening a transaction",
            async provider => {
                const { adapter, prisma, user, txUser } = setup({ provider });

                const error = await adapter.updateManyReturning({}, { name: "X" }).catch(e => e);

                expect(error).toBeInstanceOf(VSRepoAdapterError);
                expect(error.code).toBe(AdapterErrorCode.NOT_SUPPORTED);
                expect(error.message).toContain("updateManyReturning");
                expect(error.message).toContain(provider);
                expect(prisma.$transaction).not.toHaveBeenCalled();
                expect(user.updateManyAndReturn).not.toHaveBeenCalled();
                expect(txUser.updateManyAndReturn).not.toHaveBeenCalled();
            },
        );

        it.each(["postgresql", "cockroachdb", "sqlite"] as const)("should run on %s", async provider => {
            const { adapter, txUser } = setup({ provider });
            txUser.updateManyAndReturn!.mockResolvedValue([{ id: "1" }]);
            txUser.findMany!.mockResolvedValue([{ id: "1" }]);

            await expect(adapter.updateManyReturning({}, { name: "X" }, { select: { id: true } })).resolves.toEqual([
                { id: "1" },
            ]);
        });

        it("should reuse an active transaction client", async () => {
            const { adapter, prisma, txUser, tx } = setup();
            txUser.updateManyAndReturn!.mockResolvedValue([]);
            txUser.findMany!.mockResolvedValue([]);

            await adapter.updateManyReturning({}, { name: "X" }, { db: tx });

            expect(prisma.$transaction).not.toHaveBeenCalled();
            expect(txUser.updateManyAndReturn).toHaveBeenCalledTimes(1);
        });

        it("should reject with NOT_SUPPORTED when the payload has a configured relation field", async () => {
            const { adapter } = setup({ relations: relationsConfig });

            await expect(
                adapter.updateManyReturning({ id: "1" }, { address: { id: "1" } } as any),
            ).rejects.toMatchObject({ code: AdapterErrorCode.NOT_SUPPORTED });
        });

        it("should map errors", async () => {
            const { adapter, user } = setup();
            user.updateManyAndReturn!.mockRejectedValue(prismaError("PrismaClientValidationError"));

            await expect(adapter.updateManyReturning({}, { name: "X" })).rejects.toMatchObject({
                code: AdapterErrorCode.INVALID_DATA,
            });
        });
    });

    describe("createMany", () => {
        it("should call createMany with the data and skipDuplicates", async () => {
            const { adapter, user } = setup();
            user.createMany!.mockResolvedValue({ count: 2 });

            const result = await adapter.createMany([{ name: "A" }, { name: "B" }], { ignoreConflicts: true });

            expect(result).toEqual({ count: 2 });
            expect(user.createMany).toHaveBeenCalledWith({
                data: [{ name: "A" }, { name: "B" }],
                skipDuplicates: true,
            });
        });

        it("should leave skipDuplicates undefined by default", async () => {
            const { adapter, user } = setup();
            user.createMany!.mockResolvedValue({ count: 1 });

            await adapter.createMany([{ name: "A" }]);

            expect(user.createMany!.mock.calls[0]![0].skipDuplicates).toBeUndefined();
        });

        it("should reject with NOT_SUPPORTED when a record has a configured relation field", async () => {
            const { adapter, user } = setup({ relations: relationsConfig });

            await expect(adapter.createMany([{ name: "A" }, { posts: [{ title: "x" }] } as any])).rejects.toMatchObject(
                {
                    code: AdapterErrorCode.NOT_SUPPORTED,
                },
            );
            expect(user.createMany).not.toHaveBeenCalled();
        });
    });

    describe("createManyReturning", () => {
        it("should create inside a transaction and re-read the created records", async () => {
            const { adapter, prisma, txUser } = setup();
            txUser.createManyAndReturn!.mockResolvedValue([{ id: "1" }, { id: "2" }]);
            txUser.findMany!.mockResolvedValue([
                { id: "1", name: "A" },
                { id: "2", name: "B" },
            ]);

            const result = await adapter.createManyReturning([{ name: "A" }, { name: "B" }], {
                ignoreConflicts: true,
                select: { id: true, name: true },
            });

            expect(result).toEqual([
                { id: "1", name: "A" },
                { id: "2", name: "B" },
            ]);
            expect(prisma.$transaction).toHaveBeenCalledTimes(1);
            expect(txUser.createManyAndReturn).toHaveBeenCalledWith({
                data: [{ name: "A" }, { name: "B" }],
                skipDuplicates: true,
                include: undefined,
                select: { id: true },
            });
            expect(txUser.findMany).toHaveBeenCalledWith({
                where: { id: { in: ["1", "2"] } },
                select: { id: true, name: true },
            });
        });

        it("should pass the read options only to the final re-read", async () => {
            const { adapter, txUser } = setup();
            txUser.createManyAndReturn!.mockResolvedValue([{ id: "1" }]);
            txUser.findMany!.mockResolvedValue([]);

            await adapter.createManyReturning([{ name: "A" }], { relations: { posts: true } } as any);

            expect(txUser.createManyAndReturn!.mock.calls[0]![0].include).toBeUndefined();
            expect(txUser.findMany).toHaveBeenCalledWith({
                include: { posts: true },
                where: { id: { in: ["1"] } },
            });
        });

        it.each(["mysql", "sqlserver"] as const)(
            "should reject with NOT_SUPPORTED on %s without opening a transaction",
            async provider => {
                const { adapter, prisma, user, txUser } = setup({ provider });

                const error = await adapter.createManyReturning([{ name: "A" }]).catch(e => e);

                expect(error).toBeInstanceOf(VSRepoAdapterError);
                expect(error.code).toBe(AdapterErrorCode.NOT_SUPPORTED);
                expect(error.message).toContain("createManyReturning");
                expect(error.message).toContain(provider);
                expect(prisma.$transaction).not.toHaveBeenCalled();
                expect(user.createManyAndReturn).not.toHaveBeenCalled();
                expect(txUser.createManyAndReturn).not.toHaveBeenCalled();
            },
        );

        it.each(["postgresql", "cockroachdb", "sqlite"] as const)("should run on %s", async provider => {
            const { adapter, txUser } = setup({ provider });
            txUser.createManyAndReturn!.mockResolvedValue([{ id: "1" }]);
            txUser.findMany!.mockResolvedValue([{ id: "1" }]);

            await expect(adapter.createManyReturning([{ name: "A" }], { select: { id: true } })).resolves.toEqual([
                { id: "1" },
            ]);
        });

        it("should reuse an active transaction client", async () => {
            const { adapter, prisma, txUser, tx } = setup();
            txUser.createManyAndReturn!.mockResolvedValue([]);
            txUser.findMany!.mockResolvedValue([]);

            await adapter.createManyReturning([{ name: "A" }], { db: tx });

            expect(prisma.$transaction).not.toHaveBeenCalled();
        });

        it("should reject with NOT_SUPPORTED when a record has a configured relation field", async () => {
            const { adapter } = setup({ relations: relationsConfig });

            await expect(adapter.createManyReturning([{ address: { id: "1" } } as any])).rejects.toMatchObject({
                code: AdapterErrorCode.NOT_SUPPORTED,
            });
        });

        it("should map errors", async () => {
            const { adapter, user } = setup();
            user.createManyAndReturn!.mockRejectedValue(
                prismaError("PrismaClientKnownRequestError", { code: "P2002" }),
            );

            await expect(adapter.createManyReturning([{ name: "A" }])).rejects.toMatchObject({
                code: AdapterErrorCode.UNIQUE_CONSTRAINT_VIOLATION,
            });
        });
    });

    describe("delete / deleteMany", () => {
        it("should call delete with the parsed where", async () => {
            const { adapter, user } = setup();
            user.delete!.mockResolvedValue({ id: "1" });

            const result = await adapter.delete({ id: "1" });

            expect(result).toEqual({ id: "1" });
            expect(user.delete).toHaveBeenCalledWith({ where: { id: "1" } });
        });

        it("should map P2025 on delete to NOT_FOUND", async () => {
            const { adapter, user } = setup();
            user.delete!.mockRejectedValue(prismaError("PrismaClientKnownRequestError", { code: "P2025" }));

            await expect(adapter.delete({ id: "1" })).rejects.toMatchObject({ code: AdapterErrorCode.NOT_FOUND });
        });

        it("should call deleteMany with the parsed where and return the count", async () => {
            const { adapter, user } = setup();
            user.deleteMany!.mockResolvedValue({ count: 4 });

            const result = await adapter.deleteMany({ age: { lt: 18 } });

            expect(result).toEqual({ count: 4 });
            expect(user.deleteMany).toHaveBeenCalledWith({ where: { age: { lt: 18 } } });
        });
    });

    describe("deleteManyReturning", () => {
        it("should find, then delete by pk inside a transaction, and return the records", async () => {
            const { adapter, prisma, user, txUser } = setup();
            txUser.findMany!.mockResolvedValue([
                { id: "1", name: "A" },
                { id: "2", name: "B" },
            ]);
            txUser.deleteMany!.mockResolvedValue({ count: 2 });

            const result = await adapter.deleteManyReturning({ age: { lt: 18 } });

            expect(result).toEqual([
                { id: "1", name: "A" },
                { id: "2", name: "B" },
            ]);
            expect(prisma.$transaction).toHaveBeenCalledTimes(1);
            expect(txUser.findMany).toHaveBeenCalledWith({ where: { age: { lt: 18 } } });
            expect(txUser.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["1", "2"] } } });
            expect(user.findMany).not.toHaveBeenCalled();
        });

        it("should not delete anything when no record matches", async () => {
            const { adapter, txUser } = setup();
            txUser.findMany!.mockResolvedValue([]);

            const result = await adapter.deleteManyReturning({ id: "x" });

            expect(result).toEqual([]);
            expect(txUser.deleteMany).not.toHaveBeenCalled();
        });

        it("should temporarily select the pk and strip it from the result when select omits it", async () => {
            const { adapter, txUser } = setup();
            txUser.findMany!.mockResolvedValue([
                { id: "1", name: "A" },
                { id: "2", name: "B" },
            ]);
            txUser.deleteMany!.mockResolvedValue({ count: 2 });

            const result = await adapter.deleteManyReturning({}, { select: { name: true } } as any);

            expect(txUser.findMany).toHaveBeenCalledWith({ where: {}, select: { name: true, id: true } });
            expect(txUser.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["1", "2"] } } });
            expect(result).toEqual([{ name: "A" }, { name: "B" }]);
        });

        it("should keep the pk in the result when select includes it", async () => {
            const { adapter, txUser } = setup();
            txUser.findMany!.mockResolvedValue([{ id: "1", name: "A" }]);
            txUser.deleteMany!.mockResolvedValue({ count: 1 });

            const result = await adapter.deleteManyReturning({}, { select: { id: true, name: true } } as any);

            expect(result).toEqual([{ id: "1", name: "A" }]);
        });

        it("should keep the pk in the result when relations (include) are requested", async () => {
            const { adapter, txUser } = setup();
            txUser.findMany!.mockResolvedValue([{ id: "1", posts: [] }]);
            txUser.deleteMany!.mockResolvedValue({ count: 1 });

            const result = await adapter.deleteManyReturning({}, { relations: { posts: true } } as any);

            expect(txUser.findMany).toHaveBeenCalledWith({ where: {}, include: { posts: true } });
            expect(result).toEqual([{ id: "1", posts: [] }]);
        });

        it("should reuse an active transaction client", async () => {
            const { adapter, prisma, txUser, tx } = setup();
            txUser.findMany!.mockResolvedValue([{ id: "1" }]);
            txUser.deleteMany!.mockResolvedValue({ count: 1 });

            await adapter.deleteManyReturning({ id: "1" }, { db: tx });

            expect(prisma.$transaction).not.toHaveBeenCalled();
            expect(txUser.deleteMany).toHaveBeenCalledTimes(1);
        });

        it("should map errors", async () => {
            const { adapter, txUser } = setup();
            txUser.findMany!.mockRejectedValue(prismaError("PrismaClientInitializationError"));

            await expect(adapter.deleteManyReturning({})).rejects.toMatchObject({
                code: AdapterErrorCode.CONNECTION_FAILED,
            });
        });
    });

    describe("count / exists", () => {
        it("should call count with the parsed where", async () => {
            const { adapter, user } = setup();
            user.count!.mockResolvedValue(7);

            const result = await adapter.count({ age: { gte: 18 } });

            expect(result).toBe(7);
            expect(user.count).toHaveBeenCalledWith({ where: { age: { gte: 18 } } });
        });

        it("should accept an undefined where on count", async () => {
            const { adapter, user } = setup();
            user.count!.mockResolvedValue(0);

            await expect(adapter.count()).resolves.toBe(0);
        });

        it("should return true when a record exists, selecting only the pk", async () => {
            const { adapter, user } = setup();
            user.findFirst!.mockResolvedValue({ id: "1" });

            const result = await adapter.exists({ email: "a@a.com" });

            expect(result).toBe(true);
            expect(user.findFirst).toHaveBeenCalledWith({ where: { email: "a@a.com" }, select: { id: true } });
        });

        it("should return false when no record exists", async () => {
            const { adapter, user } = setup();
            user.findFirst!.mockResolvedValue(null);

            await expect(adapter.exists({ email: "x" })).resolves.toBe(false);
        });

        it("should select the configured pk on exists", async () => {
            const { adapter, user } = setup({ pkName: "email" });
            user.findFirst!.mockResolvedValue(null);

            await adapter.exists();

            expect(user.findFirst).toHaveBeenCalledWith({ where: undefined, select: { email: true } });
        });
    });

    describe("merge", () => {
        it("should return null when the record is not found", async () => {
            const { adapter, user } = setup();
            user.findFirst!.mockResolvedValue(null);

            await expect(adapter.merge({ id: "1" }, { name: "Jane" })).resolves.toBeNull();
        });

        it("should fetch the record and merge it with obj without persisting", async () => {
            const { adapter, user } = setup();
            user.findFirst!.mockResolvedValue({ id: "1", name: "John", age: 30 });

            const result = await adapter.merge({ id: "1" }, { name: "Jane" });

            expect(result).toEqual({ id: "1", name: "Jane", age: 30 });
            expect(user.findFirst).toHaveBeenCalledWith({ where: { id: "1" } });
            expect(user.update).not.toHaveBeenCalled();
            expect(user.upsert).not.toHaveBeenCalled();
        });

        it("should merge only the configured relations", async () => {
            const { adapter, user } = setup({ relations: relationsConfig });
            user.findFirst!.mockResolvedValue({
                id: "1",
                address: { id: "10", street: "Rua A" },
                posts: [{ id: "1", title: "A" }],
            });

            const result = await adapter.merge({ id: "1" }, {
                address: { street: "Rua B" },
                posts: [{ id: "2", title: "B" }],
            } as any);

            expect(result).toEqual({
                id: "1",
                address: { id: "10", street: "Rua B" },
                posts: [
                    { id: "1", title: "A" },
                    { id: "2", title: "B" },
                ],
            });
        });

        it("should apply the read options when fetching", async () => {
            const { adapter, user } = setup();
            user.findFirst!.mockResolvedValue({ id: "1" });

            await adapter.merge({ id: "1" }, { name: "Jane" }, { relations: { posts: true } } as any);

            expect(user.findFirst).toHaveBeenCalledWith({ where: { id: "1" }, include: { posts: true } });
        });
    });

    describe("query", () => {
        it("should run a non-modifying query through $queryRawUnsafe", async () => {
            const { adapter, prisma } = setup();
            prisma.$queryRawUnsafe.mockResolvedValue([{ one: 1 }]);

            const result = await adapter.query("SELECT 1", { modifying: false, args: ["a", 2] });

            expect(result).toEqual([{ one: 1 }]);
            expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith("SELECT 1", "a", 2);
            expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
        });

        it("should run a modifying query through $executeRawUnsafe", async () => {
            const { adapter, prisma } = setup();
            prisma.$executeRawUnsafe.mockResolvedValue(3);

            const result = await adapter.query("DELETE FROM users WHERE age < $1", { modifying: true, args: [18] });

            expect(result).toBe(3);
            expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith("DELETE FROM users WHERE age < $1", 18);
            expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
        });

        it("should default to a non-modifying query without args when no options are given", async () => {
            const { adapter, prisma } = setup();
            prisma.$queryRawUnsafe.mockResolvedValue([]);

            await adapter.query("SELECT 1");

            expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith("SELECT 1");
            expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
        });

        it("should use options.db instead of the root client", async () => {
            const { adapter, prisma } = setup();
            const db: any = { $queryRawUnsafe: vi.fn().mockResolvedValue([]) };

            await adapter.query("SELECT 1", { modifying: false, db });

            expect(db.$queryRawUnsafe).toHaveBeenCalledTimes(1);
            expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
        });

        it("should map errors", async () => {
            const { adapter, prisma } = setup();
            prisma.$queryRawUnsafe.mockRejectedValue(prismaError("PrismaClientKnownRequestError", { code: "P2010" }));

            await expect(adapter.query("SELECT")).rejects.toMatchObject({ code: AdapterErrorCode.INVALID_QUERY });
        });
    });

    describe("runInTransaction", () => {
        it("should run fn inside prisma.$transaction and return its result", async () => {
            const { adapter, prisma, tx } = setup();
            const fn = vi.fn().mockResolvedValue("done");

            const result = await adapter.runInTransaction(fn);

            expect(result).toBe("done");
            expect(fn).toHaveBeenCalledWith(tx);
            expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        });

        it("should forward isolationLevel and timeoutMs as timeout", async () => {
            const { adapter, prisma } = setup();
            const fn = vi.fn().mockResolvedValue(undefined);

            await adapter.runInTransaction(fn, { isolationLevel: "Serializable", timeoutMs: 5000 } as any);

            expect(prisma.$transaction).toHaveBeenCalledWith(fn, { isolationLevel: "Serializable", timeout: 5000 });
        });

        it("should map errors raised by the transaction", async () => {
            const { adapter, prisma } = setup();
            prisma.$transaction.mockRejectedValue(prismaError("PrismaClientKnownRequestError", { code: "P2034" }));

            await expect(adapter.runInTransaction(async () => 1)).rejects.toMatchObject({
                code: AdapterErrorCode.TRANSACTION_CONFLICT,
            });
        });

        it("should map errors thrown by fn", async () => {
            const { adapter } = setup();

            await expect(
                adapter.runInTransaction(async () => {
                    throw prismaError("PrismaClientKnownRequestError", { code: "P2002" });
                }),
            ).rejects.toMatchObject({ code: AdapterErrorCode.UNIQUE_CONSTRAINT_VIOLATION });
        });
    });

    describe("atomic updates (one)", () => {
        it.each([
            ["incrementOne", "increment"],
            ["decrementOne", "decrement"],
            ["multiplyOne", "multiply"],
            ["divideOne", "divide"],
        ] as const)("%s should call update with { field: { %s: value } }", async (method, operation) => {
            const { adapter, user } = setup();
            user.update!.mockResolvedValue({ id: "1", age: 10 });

            const result = await adapter[method]("age", 2, { id: "1" });

            expect(result).toEqual({ id: "1", age: 10 });
            expect(user.update).toHaveBeenCalledWith({
                where: { id: "1" },
                data: { age: { [operation]: 2 } },
            });
        });

        it("should pass the value through as-is (e.g. a Decimal)", async () => {
            const { adapter, user } = setup();
            user.update!.mockResolvedValue({});
            const value = new Decimal(1.5);

            await adapter.incrementOne("score", value as any, { id: "1" });

            expect(user.update!.mock.calls[0]![0].data.score.increment).toBe(value);
        });

        it("should apply the read options and use options.db", async () => {
            const { adapter, user, txUser, tx } = setup();
            txUser.update!.mockResolvedValue({});

            await adapter.incrementOne("age", 1, { id: "1" }, { db: tx, select: { id: true } } as any);

            expect(txUser.update).toHaveBeenCalledWith({
                where: { id: "1" },
                data: { age: { increment: 1 } },
                select: { id: true },
            });
            expect(user.update).not.toHaveBeenCalled();
        });

        it("should map errors using the method name", async () => {
            const { adapter, user } = setup();
            user.update!.mockRejectedValue(prismaError("PrismaClientKnownRequestError", { code: "P2025" }));

            const error = await adapter.decrementOne("age", 1, { id: "1" }).catch(e => e);

            expect(error).toBeInstanceOf(VSRepoAdapterError);
            expect(error.code).toBe(AdapterErrorCode.NOT_FOUND);
            expect(error.message).toContain("decrementOne");
        });
    });

    describe("atomic updates (many)", () => {
        it.each([
            ["incrementMany", "increment"],
            ["decrementMany", "decrement"],
            ["multiplyMany", "multiply"],
            ["divideMany", "divide"],
        ] as const)("%s should call updateMany with { field: { %s: value } }", async (method, operation) => {
            const { adapter, user } = setup();
            user.updateMany!.mockResolvedValue({ count: 5 });

            const result = await adapter[method]("age", 2, { age: { gt: 18 } });

            expect(result).toEqual({ count: 5 });
            expect(user.updateMany).toHaveBeenCalledWith({
                where: { age: { gt: 18 } },
                data: { age: { [operation]: 2 } },
            });
        });

        it("should use options.db", async () => {
            const { adapter, user, txUser, tx } = setup();
            txUser.updateMany!.mockResolvedValue({ count: 1 });

            await adapter.incrementMany("age", 1, {}, { db: tx });

            expect(txUser.updateMany).toHaveBeenCalledTimes(1);
            expect(user.updateMany).not.toHaveBeenCalled();
        });

        it("should map errors using the method name", async () => {
            const { adapter, user } = setup();
            user.updateMany!.mockRejectedValue(prismaError("PrismaClientValidationError"));

            const error = await adapter.multiplyMany("age", 2, {}).catch(e => e);

            expect(error.code).toBe(AdapterErrorCode.INVALID_DATA);
            expect(error.message).toContain("multiplyMany");
        });
    });

    describe("aggregations", () => {
        it.each([
            ["sum", "_sum"],
            ["average", "_avg"],
            ["min", "_min"],
            ["max", "_max"],
        ] as const)("%s should call aggregate with { %s: { field: true } }", async (method, aggKey) => {
            const { adapter, user } = setup();
            user.aggregate!.mockResolvedValue({ [aggKey]: { age: 42 } });

            const result = await adapter[method]("age", { age: { gt: 18 } });

            expect(result).toBe(42);
            expect(user.aggregate).toHaveBeenCalledWith({
                where: { age: { gt: 18 } },
                [aggKey]: { age: true },
            });
        });

        it("should accept an undefined where", async () => {
            const { adapter, user } = setup();
            user.aggregate!.mockResolvedValue({ _sum: { age: 1 } });

            await adapter.sum("age");

            expect(user.aggregate).toHaveBeenCalledWith({ where: undefined, _sum: { age: true } });
        });

        it("should return null when Prisma returns null for the aggregation", async () => {
            const { adapter, user } = setup();
            user.aggregate!.mockResolvedValue({ _sum: { age: null } });

            await expect(adapter.sum("age")).resolves.toBeNull();
        });

        it("should return null when the aggregation key is missing from the result", async () => {
            const { adapter, user } = setup();
            user.aggregate!.mockResolvedValue({});

            await expect(adapter.max("age")).resolves.toBeNull();
        });

        it("should convert a bigint to number", async () => {
            const { adapter, user } = setup();
            user.aggregate!.mockResolvedValue({ _sum: { age: 10n } });

            await expect(adapter.sum("age")).resolves.toBe(10);
        });

        it("should convert a Decimal to number", async () => {
            const { adapter, user } = setup();
            user.aggregate!.mockResolvedValue({ _avg: { score: new Decimal(3.5) } });

            await expect(adapter.average("score")).resolves.toBe(3.5);
        });

        it("should keep 0 as 0 (not null)", async () => {
            const { adapter, user } = setup();
            user.aggregate!.mockResolvedValue({ _sum: { age: 0 } });

            await expect(adapter.sum("age")).resolves.toBe(0);
        });

        it("should use options.db", async () => {
            const { adapter, user, txUser, tx } = setup();
            txUser.aggregate!.mockResolvedValue({ _min: { age: 1 } });

            await adapter.min("age", {}, { db: tx });

            expect(txUser.aggregate).toHaveBeenCalledTimes(1);
            expect(user.aggregate).not.toHaveBeenCalled();
        });

        it("should map errors", async () => {
            const { adapter, user } = setup();
            user.aggregate!.mockRejectedValue(prismaError("PrismaClientInitializationError"));

            await expect(adapter.sum("age")).rejects.toMatchObject({ code: AdapterErrorCode.CONNECTION_FAILED });
        });
    });
});
