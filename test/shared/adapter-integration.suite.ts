import "dotenv/config";
import { AdapterErrorCode, VSLogLevel, VSRepoAdapterError } from "vsrepo";
import { VSRepoPrisma7Adapter } from "../../src/prisma7.adapter.js";
import { PrismaProvider } from "../../src/types/prisma-provider.type.js";

/**
 * What each database/driver can (or cannot) do through Prisma. Used to run the
 * same scenarios everywhere while asserting the right outcome per provider.
 */
export interface ProviderCapabilities {
    /** `createManyAndReturn` / `updateManyAndReturn` (PostgreSQL, CockroachDB and SQLite only). */
    returningMany: boolean;
    /** `createMany({ skipDuplicates })` (not supported by SQLite nor SQL Server). */
    skipDuplicates: boolean;
    /** Prisma's `mode: "insensitive"` filter, i.e. `ignoreCase` (PostgreSQL only, see the README). */
    insensitiveMode: boolean;
    /**
     * Whether a read made OUTSIDE an open transaction returns immediately without seeing its
     * uncommitted writes. False on SQLite (single connection: it sees them), on SQL Server
     * (READ COMMITTED: the read blocks on the transaction's locks) and on CockroachDB
     * (SERIALIZABLE: the read waits for the writer's intents).
     */
    isolatedReadsDuringTransaction: boolean;
}

export interface AdapterIntegrationConfig {
    /** Name shown in the test report. */
    name: string;
    /** Provider the adapter is expected to detect from the client. */
    provider: PrismaProvider;
    /** Lazily loads the Prisma Client, so a disabled provider never opens a connection. */
    load: () => Promise<any>;
    capabilities: ProviderCapabilities;
    /** Quotes a table/column name for raw SQL (`"User"`, `` `User` ``, `[User]`). */
    quote: (identifier: string) => string;
    /** Expected raw-query placeholder for an index. */
    placeholder: (index: number) => string;
}

interface AddressRow {
    id: number;
    street: string;
    city: string;
    country: string;
    userId: number;
}

interface PostRow {
    id: number;
    title: string;
    content: string | null;
    published: boolean;
    price: any;
    authorId: number;
    tags?: TagRow[];
}

interface TagRow {
    id: number;
    name: string;
}

interface UserRow {
    id: number;
    email: string;
    name: string | null;
    balance: number;
    bonusPoints: number | null;
    posts?: PostRow[];
    address?: AddressRow | null;
}

const userRelations = {
    address: { mode: "oto", restriction: "set", pk: "id", nullable: true },
    posts: { mode: "otm", restriction: "set", pk: "id" },
} as any;

const postRelations = {
    tags: { mode: "mtm", restriction: "set", pk: "id" },
} as any;

/** Deterministic text ordering (`null` sorts as the text "null", after any name). */
const compareText = (a: unknown, b: unknown): number => String(a).localeCompare(String(b));

export function defineAdapterIntegrationSuite(config: AdapterIntegrationConfig): void {
    const { capabilities, quote, placeholder } = config;

    describe(`VSRepoPrisma7Adapter — ${config.name}`, () => {
        let prisma: any;
        let users: VSRepoPrisma7Adapter<UserRow>;
        let posts: VSRepoPrisma7Adapter<PostRow>;
        let sequence = 0;

        beforeAll(async () => {
            prisma = await config.load();

            users = new VSRepoPrisma7Adapter<UserRow>(prisma, {
                modelName: "user",
                pkName: "id",
                relations: userRelations,
                logLevel: VSLogLevel.NONE,
            } as any);

            posts = new VSRepoPrisma7Adapter<PostRow>(prisma, {
                modelName: "post",
                pkName: "id",
                relations: postRelations,
                logLevel: VSLogLevel.NONE,
            } as any);
        });

        afterAll(async () => {
            await prisma?.$disconnect();
        });

        beforeEach(async () => {
            await prisma.address.deleteMany();
            await prisma.post.deleteMany();
            await prisma.tag.deleteMany();
            await prisma.user.deleteMany();
        });

        /** Seeds straight through Prisma, so the adapter under test is never used to prepare data. */
        function seedUser(data: Record<string, unknown> = {}): Promise<UserRow> {
            sequence++;
            return prisma.user.create({ data: { email: `user${sequence}@mail.com`, ...data } });
        }

        function seedPost(authorId: number, data: Record<string, unknown> = {}): Promise<PostRow> {
            sequence++;
            return prisma.post.create({ data: { title: `post ${sequence}`, authorId, ...data } });
        }

        /** Alice(10) Bob(20) Carol(30) Dave(40, bonus 5) Eve(50, no name). */
        async function seedDirectory(): Promise<Record<string, UserRow>> {
            const alice = await seedUser({ name: "Alice", email: "alice@mail.com", balance: 10 });
            const bob = await seedUser({ name: "Bob", email: "bob@mail.com", balance: 20 });
            const carol = await seedUser({ name: "Carol", email: "carol@mail.com", balance: 30 });
            const dave = await seedUser({ name: "Dave", email: "dave@mail.com", balance: 40, bonusPoints: 5 });
            const eve = await seedUser({ email: "eve@mail.com", balance: 50 });

            return { alice, bob, carol, dave, eve };
        }

        const names = (rows: Array<{ name: string | null }>) => rows.map(r => r.name).sort(compareText);

        describe("provider detection", () => {
            it(`should detect '${config.provider}' from the Prisma Client`, () => {
                expect(users.getPlaceholder(0)).toBe(placeholder(0));
                expect(users.getPlaceholder(2)).toBe(placeholder(2));
            });

            it("should expose the pk name and the underlying client", () => {
                expect(users.getPkName()).toBe("id");
                expect(users.getDbClient()).toBe(prisma);
            });
        });

        describe("reads", () => {
            it("should create a record and apply database defaults", async () => {
                const created = await users.create({ email: "john@mail.com", name: "John" });

                expect(created.id).toEqual(expect.any(Number));
                expect(created).toMatchObject({ email: "john@mail.com", name: "John", balance: 0, bonusPoints: null });
            });

            it("should find one by pk and return null when it does not exist", async () => {
                const john = await seedUser({ name: "John" });

                await expect(users.findOne({ id: john.id })).resolves.toMatchObject({ name: "John" });
                await expect(users.findOne({ id: john.id + 9999 })).resolves.toBeNull();
            });

            it("should throw NOT_FOUND on findOneOrThrow when nothing matches", async () => {
                await expect(users.findOneOrThrow({ email: "nobody@mail.com" })).rejects.toMatchObject({
                    code: AdapterErrorCode.NOT_FOUND,
                });
            });

            it("should find many, count and check existence", async () => {
                await seedDirectory();

                await expect(users.findMany()).resolves.toHaveLength(5);
                await expect(users.count()).resolves.toBe(5);
                await expect(users.count({ balance: { gte: 30 } })).resolves.toBe(3);
                await expect(users.exists({ email: "alice@mail.com" })).resolves.toBe(true);
                await expect(users.exists({ email: "nobody@mail.com" })).resolves.toBe(false);
            });

            it("should only return the selected fields", async () => {
                await seedUser({ name: "John", email: "john@mail.com" });

                const [row] = await users.findMany({}, { select: { id: true, name: true } } as any);

                expect(Object.keys(row!).sort(compareText)).toEqual(["id", "name"]);
            });

            it("should order and paginate", async () => {
                await seedDirectory();

                const page = await users.findMany({ name: { not: null } }, {
                    order: { balance: "DESC" },
                    pagination: { offset: 1, limit: 2 },
                } as any);

                expect(page.map(u => u.name)).toEqual(["Carol", "Bob"]);
            });

            it("should order by several fields", async () => {
                await seedUser({ name: "B", email: "b1@mail.com", balance: 1 });
                await seedUser({ name: "A", email: "a2@mail.com", balance: 1 });
                await seedUser({ name: "C", email: "c3@mail.com", balance: 0 });

                const rows = await users.findMany({}, { order: [{ balance: "asc" }, { name: "desc" }] } as any);

                expect(rows.map(r => r.name)).toEqual(["C", "B", "A"]);
            });

            it("should include relations", async () => {
                const john = await seedUser({
                    name: "John",
                    address: { create: { street: "Rua A", city: "Aracaju", country: "BR" } },
                });
                await seedPost(john.id, { title: "first" });

                const found = await users.findOne({ id: john.id }, {
                    relations: { posts: true, address: true },
                } as any);

                expect(found!.posts).toHaveLength(1);
                expect(found!.address).toMatchObject({ street: "Rua A" });
            });

            it("should include nested relations", async () => {
                const john = await seedUser({ name: "John" });
                const post = await seedPost(john.id);
                await prisma.tag.create({ data: { name: "ts", posts: { connect: { id: post.id } } } });

                const found = await users.findOne({ id: john.id }, { relations: { posts: { tags: true } } } as any);

                expect(found!.posts![0]!.tags).toHaveLength(1);
            });
        });

        describe("where operators", () => {
            beforeEach(async () => {
                await seedDirectory();
            });

            it("should match equality, in and notIn", async () => {
                expect(names(await users.findMany({ name: "Alice" }))).toEqual(["Alice"]);
                expect(names(await users.findMany({ name: { in: ["Alice", "Bob"] } }))).toEqual(["Alice", "Bob"]);
                expect(names(await users.findMany({ balance: { notIn: [10, 20, 30, 40] } }))).toEqual([null]);
            });

            it("should compare numbers", async () => {
                expect(names(await users.findMany({ balance: { gt: 40 } }))).toEqual([null]);
                expect(names(await users.findMany({ balance: { lt: 20 } }))).toEqual(["Alice"]);
                expect(names(await users.findMany({ balance: { gte: 40 } }))).toEqual(["Dave", null]);
                expect(names(await users.findMany({ balance: { lte: 20 } }))).toEqual(["Alice", "Bob"]);
            });

            it("should match between (inclusive)", async () => {
                expect(names(await users.findMany({ balance: { between: [20, 40] } }))).toEqual([
                    "Bob",
                    "Carol",
                    "Dave",
                ]);
            });

            it("should match string operators", async () => {
                expect(names(await users.findMany({ name: { contains: "ar" } }))).toEqual(["Carol"]);
                expect(names(await users.findMany({ name: { startsWith: "Da" } }))).toEqual(["Dave"]);
                expect(names(await users.findMany({ name: { endsWith: "ob" } }))).toEqual(["Bob"]);
            });

            it("should match null and not null", async () => {
                expect(await users.findMany({ name: null })).toHaveLength(1);
                expect(await users.findMany({ name: { not: null } })).toHaveLength(4);
                expect(names(await users.findMany({ bonusPoints: { not: null } }))).toEqual(["Dave"]);
            });

            it("should match not with a value and with a nested operator", async () => {
                expect(await users.findMany({ name: { not: "Alice" } })).toHaveLength(3);
                expect(names(await users.findMany({ name: { not: { startsWith: "A" } } }))).toEqual([
                    "Bob",
                    "Carol",
                    "Dave",
                ]);
            });

            it("should combine AND, OR and NOT", async () => {
                const or = await users.findMany({ OR: [{ name: "Alice" }, { balance: { gte: 50 } }] });
                const and = await users.findMany({ AND: [{ balance: { gt: 10 } }, { balance: { lt: 40 } }] });
                const not = await users.findMany({ NOT: { balance: { gt: 20 } } });

                expect(names(or)).toEqual(["Alice", null]);
                expect(names(and)).toEqual(["Bob", "Carol"]);
                expect(names(not)).toEqual(["Alice", "Bob"]);
            });

            it("should reject the unsupported 'like' operator before touching the database", async () => {
                await expect(users.findMany({ name: { like: "A%" } })).rejects.toMatchObject({
                    code: AdapterErrorCode.NOT_SUPPORTED,
                });
            });

            it("should filter by to-many relations (_some/_none/_every)", async () => {
                const alice = (await users.findOne({ name: "Alice" }))!;
                const bob = (await users.findOne({ name: "Bob" }))!;
                await seedPost(alice.id, { title: "hello", published: true });
                await seedPost(alice.id, { title: "draft", published: false });
                await seedPost(bob.id, { title: "bye", published: true });

                const some = await users.findMany({ posts: { _some: { title: "draft" } } } as any);
                const none = await users.findMany({ posts: { _none: {} } } as any);
                const every = await users.findMany({
                    AND: [{ posts: { _some: {} } }, { posts: { _every: { published: true } } }],
                } as any);

                expect(names(some)).toEqual(["Alice"]);
                expect(names(none)).toEqual(["Carol", "Dave", null]);
                expect(names(every)).toEqual(["Bob"]);
            });

            it("should filter by to-one relations (_with/_without)", async () => {
                const carol = (await users.findOne({ name: "Carol" }))!;
                await prisma.address.create({
                    data: { street: "Rua A", city: "Aracaju", country: "BR", userId: carol.id },
                });

                const withAddress = await users.findMany({ address: { _with: { city: "Aracaju" } } } as any);
                const withoutAracaju = await users.findMany({ address: { _without: { city: "Aracaju" } } } as any);

                expect(names(withAddress)).toEqual(["Carol"]);
                expect(withoutAracaju).toHaveLength(4);
            });

            it("should apply operators inside relation filters", async () => {
                const alice = (await users.findOne({ name: "Alice" }))!;
                await seedPost(alice.id, { title: "Hello World" });

                const found = await users.findMany({ posts: { _some: { title: { startsWith: "Hello" } } } } as any);

                expect(names(found)).toEqual(["Alice"]);
            });

            it("should reject 'like' nested inside a relation filter", async () => {
                await expect(
                    users.findMany({ posts: { _some: { title: { like: "%x%" } } } } as any),
                ).rejects.toMatchObject({ code: AdapterErrorCode.NOT_SUPPORTED });
            });

            if (capabilities.insensitiveMode) {
                it("should match case-insensitively with ignoreCase", async () => {
                    const found = await users.findMany({ name: { contains: "ALI", ignoreCase: true } });

                    expect(names(found)).toEqual(["Alice"]);
                });

                it("should match case-sensitively without ignoreCase", async () => {
                    await expect(users.findMany({ name: { contains: "ALI" } })).resolves.toHaveLength(0);
                });
            } else {
                // Prisma only has `mode: "insensitive"` on PostgreSQL, so the adapter refuses
                // `ignoreCase` here instead of sending a query the database client would reject.
                it("should reject ignoreCase with NOT_SUPPORTED", async () => {
                    await expect(users.findMany({ name: { contains: "ALI", ignoreCase: true } })).rejects.toMatchObject(
                        { code: AdapterErrorCode.NOT_SUPPORTED },
                    );
                });

                it("should reject ignoreCase nested in a relation filter with NOT_SUPPORTED", async () => {
                    await expect(
                        users.findMany({ posts: { _some: { title: { contains: "x", ignoreCase: true } } } } as any),
                    ).rejects.toMatchObject({ code: AdapterErrorCode.NOT_SUPPORTED });
                });

                it("should still filter when ignoreCase is false (the database collation decides)", async () => {
                    const found = await users.findMany({ name: { contains: "lic", ignoreCase: false } });

                    expect(names(found)).toEqual(["Alice"]);
                });
            }
        });

        describe("writes", () => {
            it("should save a new record when the pk is missing", async () => {
                const saved = await users.save({ email: "john@mail.com", name: "John" });

                expect(saved.id).toEqual(expect.any(Number));
                await expect(prisma.user.count()).resolves.toBe(1);
            });

            it("should save (upsert) an existing record by pk", async () => {
                const john = await seedUser({ name: "John" });

                const saved = await users.save({ id: john.id, email: john.email, name: "Johnny" });

                expect(saved).toMatchObject({ id: john.id, name: "Johnny", email: john.email });
                await expect(prisma.user.count()).resolves.toBe(1);
            });

            it("should saveMany mixing inserts and updates", async () => {
                const john = await seedUser({ name: "John" });

                const saved = await users.saveMany([
                    { id: john.id, email: john.email, name: "Johnny" },
                    { email: "jane@mail.com", name: "Jane" },
                ]);

                expect(saved).toHaveLength(2);
                expect(names(await prisma.user.findMany())).toEqual(["Jane", "Johnny"]);
            });

            it("should roll back every record of saveMany when one of them fails", async () => {
                await seedUser({ email: "taken@mail.com" });

                await expect(
                    users.saveMany([{ email: "new@mail.com", name: "New" }, { email: "taken@mail.com" }]),
                ).rejects.toMatchObject({ code: AdapterErrorCode.UNIQUE_CONSTRAINT_VIOLATION });

                await expect(prisma.user.count({ where: { email: "new@mail.com" } })).resolves.toBe(0);
            });

            it("should update a record", async () => {
                const john = await seedUser({ name: "John" });

                const updated = await users.update({ id: john.id }, { name: "Johnny", balance: 99 });

                expect(updated).toMatchObject({ name: "Johnny", balance: 99 });
            });

            it("should throw NOT_FOUND when updating a missing record", async () => {
                await expect(users.update({ id: 987654 }, { name: "x" })).rejects.toMatchObject({
                    code: AdapterErrorCode.NOT_FOUND,
                });
            });

            it("should upsert by a unique field (create, then update)", async () => {
                const where = { email: "john@mail.com" };

                const created = await users.upsert(where, { email: "john@mail.com", name: "John" }, { name: "X" });
                const updated = await users.upsert(where, { email: "john@mail.com", name: "John" }, { name: "Johnny" });

                expect(created.name).toBe("John");
                expect(updated).toMatchObject({ id: created.id, name: "Johnny" });
                await expect(prisma.user.count()).resolves.toBe(1);
            });

            it("should updateMany and report the affected count", async () => {
                await seedDirectory();

                const result = await users.updateMany({ balance: { gte: 30 } }, { bonusPoints: 1 });

                expect(result).toEqual({ count: 3 });
                await expect(prisma.user.count({ where: { bonusPoints: 1 } })).resolves.toBe(3);
            });

            it("should delete a record and return it", async () => {
                const john = await seedUser({ name: "John" });

                const deleted = await users.delete({ id: john.id });

                expect(deleted).toMatchObject({ id: john.id, name: "John" });
                await expect(prisma.user.count()).resolves.toBe(0);
            });

            it("should throw NOT_FOUND when deleting a missing record", async () => {
                await expect(users.delete({ id: 987654 })).rejects.toMatchObject({
                    code: AdapterErrorCode.NOT_FOUND,
                });
            });

            it("should deleteMany and report the affected count", async () => {
                await seedDirectory();

                await expect(users.deleteMany({ balance: { lte: 20 } })).resolves.toEqual({ count: 2 });
                await expect(prisma.user.count()).resolves.toBe(3);
            });

            it("should deleteManyReturning the deleted records", async () => {
                await seedDirectory();

                const deleted = await users.deleteManyReturning({ balance: { lte: 20 } });

                expect(names(deleted)).toEqual(["Alice", "Bob"]);
                expect(deleted[0]).toHaveProperty("id");
                await expect(prisma.user.count()).resolves.toBe(3);
            });

            it("should deleteManyReturning without leaking the pk when select omits it", async () => {
                await seedDirectory();

                const deleted = await users.deleteManyReturning({ balance: { lte: 20 } }, {
                    select: { name: true },
                } as any);

                expect(deleted.map(d => d.name).sort(compareText)).toEqual(["Alice", "Bob"]);
                expect(deleted[0]).not.toHaveProperty("id");
                await expect(prisma.user.count()).resolves.toBe(3);
            });

            it("should deleteManyReturning an empty array when nothing matches", async () => {
                await expect(users.deleteManyReturning({ email: "nobody" })).resolves.toEqual([]);
            });
        });

        describe("bulk writes", () => {
            it("should createMany and report the count", async () => {
                const result = await users.createMany([{ email: "a@mail.com" }, { email: "b@mail.com" }]);

                expect(result).toEqual({ count: 2 });
                await expect(prisma.user.count()).resolves.toBe(2);
            });

            it("should throw UNIQUE_CONSTRAINT_VIOLATION on createMany duplicates", async () => {
                await seedUser({ email: "a@mail.com" });

                await expect(users.createMany([{ email: "a@mail.com" }])).rejects.toMatchObject({
                    code: AdapterErrorCode.UNIQUE_CONSTRAINT_VIOLATION,
                });
            });

            if (capabilities.skipDuplicates) {
                it("should skip conflicting rows with ignoreConflicts", async () => {
                    await seedUser({ email: "a@mail.com" });

                    await users.createMany([{ email: "a@mail.com" }, { email: "c@mail.com" }], {
                        ignoreConflicts: true,
                    });

                    await expect(prisma.user.count()).resolves.toBe(2);
                    await expect(prisma.user.count({ where: { email: "c@mail.com" } })).resolves.toBe(1);
                });
            } else {
                it("should reject ignoreConflicts with a VSRepoAdapterError (skipDuplicates is unsupported)", async () => {
                    const error = await users
                        .createMany([{ email: "a@mail.com" }], { ignoreConflicts: true })
                        .catch(e => e);

                    expect(error).toBeInstanceOf(VSRepoAdapterError);
                    await expect(prisma.user.count()).resolves.toBe(0);
                });
            }

            it("should reject relation fields on createMany/updateMany with NOT_SUPPORTED", async () => {
                await expect(users.createMany([{ email: "a@mail.com", posts: [] }])).rejects.toMatchObject({
                    code: AdapterErrorCode.NOT_SUPPORTED,
                });
                await expect(users.updateMany({}, { posts: [] })).rejects.toMatchObject({
                    code: AdapterErrorCode.NOT_SUPPORTED,
                });
            });

            if (capabilities.returningMany) {
                it("should createManyReturning the created records", async () => {
                    const created = await users.createManyReturning([
                        { email: "a@mail.com", name: "A" },
                        { email: "b@mail.com", name: "B" },
                    ]);

                    expect(names(created)).toEqual(["A", "B"]);
                    expect(created[0]!.id).toEqual(expect.any(Number));
                });

                it("should createManyReturning applying select", async () => {
                    const created = await users.createManyReturning(
                        [
                            { email: "a@mail.com", name: "A" },
                            { email: "b@mail.com", name: "B" },
                        ],
                        { select: { name: true } } as any,
                    );

                    expect(created.map(c => c.name).sort(compareText)).toEqual(["A", "B"]);
                    expect(created[0]).not.toHaveProperty("id");
                });

                it("should updateManyReturning the updated records", async () => {
                    await seedDirectory();

                    const updated = await users.updateManyReturning({ balance: { lte: 20 } }, { bonusPoints: 7 });

                    expect(names(updated)).toEqual(["Alice", "Bob"]);
                    expect(updated.every(u => u.bonusPoints === 7)).toBe(true);
                });

                it("should updateManyReturning an empty array when nothing matches", async () => {
                    await expect(users.updateManyReturning({ email: "nobody" }, { bonusPoints: 1 })).resolves.toEqual(
                        [],
                    );
                });
            } else {
                // The provider has no native createManyAndReturn/updateManyAndReturn.
                it("should reject createManyReturning with NOT_SUPPORTED without writing anything", async () => {
                    const error = await users.createManyReturning([{ email: "a@mail.com" }]).catch(e => e);

                    expect(error).toBeInstanceOf(VSRepoAdapterError);
                    expect(error.code).toBe(AdapterErrorCode.NOT_SUPPORTED);
                    await expect(prisma.user.count()).resolves.toBe(0);
                });

                it("should reject updateManyReturning with NOT_SUPPORTED without writing anything", async () => {
                    await seedUser({ email: "a@mail.com", name: "A" });

                    const error = await users.updateManyReturning({}, { name: "X" }).catch(e => e);

                    expect(error).toBeInstanceOf(VSRepoAdapterError);
                    expect(error.code).toBe(AdapterErrorCode.NOT_SUPPORTED);
                    expect((await prisma.user.findFirst()).name).toBe("A");
                });
            }
        });

        describe("relations", () => {
            it("should create a record with nested to-one and to-many relations", async () => {
                const created = await users.create({
                    email: "john@mail.com",
                    name: "John",
                    address: { street: "Rua A", city: "Aracaju", country: "BR" },
                    posts: [{ title: "first" }, { title: "second" }],
                } as any);

                const stored = await prisma.user.findUnique({
                    where: { id: created.id },
                    include: { address: true, posts: true },
                });
                expect(stored.address).toMatchObject({ street: "Rua A" });
                expect(stored.posts.map((p: PostRow) => p.title).sort(compareText)).toEqual(["first", "second"]);
            });

            it("should update the nested to-one relation (set => upsert)", async () => {
                const john = await seedUser({
                    address: { create: { street: "Rua A", city: "Aracaju", country: "BR" } },
                });

                await users.update({ id: john.id }, {
                    address: { street: "Rua B", city: "Estância", country: "BR" },
                } as any);

                const address = await prisma.address.findUnique({ where: { userId: john.id } });
                expect(address).toMatchObject({ street: "Rua B", city: "Estância" });
                await expect(prisma.address.count()).resolves.toBe(1);
            });

            it("should delete the nested nullable to-one relation when it is set to null", async () => {
                const john = await seedUser({
                    address: { create: { street: "Rua A", city: "Aracaju", country: "BR" } },
                });

                await users.update({ id: john.id }, { address: null } as any);

                await expect(prisma.address.count()).resolves.toBe(0);
            });

            it("should replace the to-many relation when the restriction is 'set'", async () => {
                const john = await seedUser({ name: "John" });
                const keep = await seedPost(john.id, { title: "keep" });
                await seedPost(john.id, { title: "drop" });

                await users.update({ id: john.id }, {
                    posts: [{ id: keep.id, title: "kept and renamed" }, { title: "brand new" }],
                } as any);

                const titles = (await prisma.post.findMany({ where: { authorId: john.id } }))
                    .map((p: PostRow) => p.title)
                    .sort(compareText);
                expect(titles).toEqual(["brand new", "kept and renamed"]);
            });

            it("should remove every item when the to-many relation is set to an empty array", async () => {
                const john = await seedUser({ name: "John" });
                await seedPost(john.id);
                await seedPost(john.id);

                await users.update({ id: john.id }, { posts: [] } as any);

                await expect(prisma.post.count({ where: { authorId: john.id } })).resolves.toBe(0);
            });

            it("should save a record together with its relations", async () => {
                const saved = await users.save({
                    email: "john@mail.com",
                    address: { street: "Rua A", city: "Aracaju", country: "BR" },
                    posts: [{ title: "first" }],
                } as any);

                const again = await users.save({
                    id: saved.id,
                    email: saved.email,
                    posts: [{ title: "second" }],
                } as any);

                expect(again.id).toBe(saved.id);
                const posts = await prisma.post.findMany({ where: { authorId: saved.id } });
                expect(posts.map((p: PostRow) => p.title)).toEqual(["second"]);
                await expect(prisma.address.count()).resolves.toBe(1);
            });

            it("should connect many-to-many relations on create and replace them on update", async () => {
                const john = await seedUser({ name: "John" });
                const react = await prisma.tag.create({ data: { name: "react" } });
                const vue = await prisma.tag.create({ data: { name: "vue" } });

                const post = await posts.create({
                    title: "frameworks",
                    authorId: john.id,
                    tags: [{ id: react.id, name: "react" }],
                } as any);
                await posts.update({ id: post.id }, { tags: [{ id: vue.id, name: "vue" }] } as any);

                const stored = await prisma.post.findUnique({ where: { id: post.id }, include: { tags: true } });
                expect(stored.tags.map((t: TagRow) => t.name)).toEqual(["vue"]);
            });
        });

        describe("merge", () => {
            it("should return null when nothing matches", async () => {
                await expect(users.merge({ email: "nobody" }, { name: "x" })).resolves.toBeNull();
            });

            it("should merge the stored record with obj without persisting it", async () => {
                const john = await seedUser({ name: "John", balance: 5 });

                const merged = await users.merge({ id: john.id }, { name: "Johnny" });

                expect(merged).toMatchObject({ id: john.id, name: "Johnny", balance: 5 });
                await expect(prisma.user.findUnique({ where: { id: john.id } })).resolves.toMatchObject({
                    name: "John",
                });
            });

            it("should merge relations given by obj", async () => {
                const john = await seedUser({ name: "John" });
                const first = await seedPost(john.id, { title: "first" });

                const merged = await users.merge(
                    { id: john.id },
                    { posts: [{ id: first.id, title: "renamed" }] } as any,
                    {
                        relations: { posts: true },
                    } as any,
                );

                expect(merged!.posts).toEqual([expect.objectContaining({ id: first.id, title: "renamed" })]);
            });

            it("should persist a merged record through save when no relation is loaded", async () => {
                const john = await seedUser({ name: "John" });

                const merged = await users.merge({ id: john.id }, { name: "Johnny" });
                await users.save(merged as any);

                await expect(prisma.user.findUnique({ where: { id: john.id } })).resolves.toMatchObject({
                    name: "Johnny",
                });
            });
        });

        describe("Decimal values", () => {
            it("should round-trip a Decimal column", async () => {
                const john = await seedUser();

                const created = await posts.create({ title: "priced", authorId: john.id, price: "10.50" } as any);
                const found = await posts.findOne({ id: created.id });

                expect(found!.price.toNumber()).toBe(10.5);
            });

            it("should keep the Decimal instance when merging", async () => {
                const john = await seedUser();
                const post = await seedPost(john.id, { price: "19.99" });

                const merged = await posts.merge({ id: post.id }, { title: "renamed" });

                expect(typeof merged!.price.toNumber).toBe("function");
                expect(merged!.price.toNumber()).toBe(19.99);
            });

            it("should accept a Decimal-like value as an atomic operand on a Decimal column", async () => {
                const john = await seedUser();
                const post = await seedPost(john.id, { price: "10.00" });

                const updated = await posts.incrementOne("price" as any, "2.50" as any, { id: post.id });

                expect(updated.price.toNumber()).toBe(12.5);
            });
        });

        describe("atomic updates", () => {
            it("should increment and decrement", async () => {
                const john = await seedUser({ balance: 10 });

                expect((await users.incrementOne("balance", 5, { id: john.id })).balance).toBe(15);
                expect((await users.decrementOne("balance", 3, { id: john.id })).balance).toBe(12);
            });

            it("should multiply and divide (exact divisions only: rounding differs between databases)", async () => {
                const john = await seedUser({ balance: 10 });

                expect((await users.multiplyOne("balance", 4, { id: john.id })).balance).toBe(40);
                expect((await users.divideOne("balance", 8, { id: john.id })).balance).toBe(5);
            });

            it("should not lose concurrent increments (server-side evaluation)", async () => {
                const john = await seedUser({ balance: 0 });

                await Promise.all(Array.from({ length: 10 }, () => users.incrementOne("balance", 1, { id: john.id })));

                expect((await users.findOne({ id: john.id }))!.balance).toBe(10);
            });

            it("should throw NOT_FOUND when the record does not exist", async () => {
                await expect(users.incrementOne("balance", 1, { id: 987654 })).rejects.toMatchObject({
                    code: AdapterErrorCode.NOT_FOUND,
                });
            });

            it("should apply the *Many variants to every matching record", async () => {
                await seedDirectory();
                const balanceOf = async (name: string) =>
                    (await users.findOne({ email: `${name.toLowerCase()}@mail.com` }))!.balance;

                await expect(users.incrementMany("balance", 5, { balance: { lte: 20 } })).resolves.toEqual({
                    count: 2,
                });
                expect([await balanceOf("Alice"), await balanceOf("Bob")]).toEqual([15, 25]);

                await expect(users.decrementMany("balance", 5, { name: { in: ["Alice", "Bob"] } })).resolves.toEqual({
                    count: 2,
                });
                expect([await balanceOf("Alice"), await balanceOf("Bob")]).toEqual([10, 20]);

                await expect(users.multiplyMany("balance", 2, { balance: { gte: 40 } })).resolves.toEqual({ count: 2 });
                expect([await balanceOf("Dave"), await balanceOf("Eve")]).toEqual([80, 100]);

                await expect(users.divideMany("balance", 2, { balance: { gte: 80 } })).resolves.toEqual({ count: 2 });
                expect([await balanceOf("Dave"), await balanceOf("Eve")]).toEqual([40, 50]);
            });

            it("should apply the *Many variants inside a transaction", async () => {
                await seedDirectory();

                await users.runInTransaction(async tx => {
                    await users.incrementMany("balance", 1, {}, { db: tx });
                });

                await expect(users.sum("balance")).resolves.toBe(155);
            });
        });

        describe("aggregations", () => {
            it("should sum, average, min and max", async () => {
                await seedDirectory();

                await expect(users.sum("balance")).resolves.toBe(150);
                await expect(users.average("balance")).resolves.toBe(30);
                await expect(users.min("balance")).resolves.toBe(10);
                await expect(users.max("balance")).resolves.toBe(50);
            });

            it("should respect the where", async () => {
                await seedDirectory();

                await expect(users.sum("balance", { balance: { gte: 30 } })).resolves.toBe(120);
                await expect(users.max("balance", { name: "Bob" })).resolves.toBe(20);
            });

            it("should return null (not 0) when no record matches", async () => {
                await expect(users.sum("balance")).resolves.toBeNull();
                await expect(users.average("balance")).resolves.toBeNull();
                await expect(users.min("balance")).resolves.toBeNull();
                await expect(users.max("balance")).resolves.toBeNull();
            });

            it("should return null when every value is NULL", async () => {
                await seedUser({ bonusPoints: null });

                await expect(users.sum("bonusPoints")).resolves.toBeNull();
            });

            it("should aggregate Decimal columns into numbers", async () => {
                const john = await seedUser();
                await seedPost(john.id, { price: "10.25" });
                await seedPost(john.id, { price: "20.75" });

                await expect(posts.sum("price" as any)).resolves.toBe(31);
                await expect(posts.average("price" as any)).resolves.toBe(15.5);
                await expect(posts.min("price" as any)).resolves.toBe(10.25);
                await expect(posts.max("price" as any)).resolves.toBe(20.75);
            });
        });

        describe("raw queries", () => {
            const table = () => quote("User");

            it("should run a read query with placeholders", async () => {
                await seedDirectory();

                const rows = await users.query<Array<{ total: number | bigint | string }>>(
                    `SELECT COUNT(*) AS total FROM ${table()} WHERE ${quote("balance")} >= ${users.getPlaceholder(0)}`,
                    { modifying: false, args: [30] },
                );

                expect(Number(rows[0]!.total)).toBe(3);
            });

            it("should run a modifying statement and return the affected rows", async () => {
                await seedDirectory();

                const affected = await users.query<number>(
                    `UPDATE ${table()} SET ${quote("bonusPoints")} = ${users.getPlaceholder(0)} WHERE ${quote("balance")} <= ${users.getPlaceholder(1)}`,
                    { modifying: true, args: [9, 20] },
                );

                expect(affected).toBe(2);
                await expect(prisma.user.count({ where: { bonusPoints: 9 } })).resolves.toBe(2);
            });

            it("should map a broken statement to a VSRepoAdapterError", async () => {
                const error = await users.query("SELEKT nothing", { modifying: false }).catch(e => e);

                expect(error).toBeInstanceOf(VSRepoAdapterError);
            });
        });

        describe("transactions", () => {
            it("should commit when the callback resolves", async () => {
                await users.runInTransaction(async tx => {
                    await users.create({ email: "a@mail.com" }, { db: tx });
                    await users.create({ email: "b@mail.com" }, { db: tx });
                });

                await expect(prisma.user.count()).resolves.toBe(2);
            });

            it("should roll back when the callback throws", async () => {
                const failing = users.runInTransaction(async tx => {
                    await users.create({ email: "a@mail.com" }, { db: tx });
                    throw new Error("boom");
                });

                await expect(failing).rejects.toBeInstanceOf(VSRepoAdapterError);
                await expect(prisma.user.count()).resolves.toBe(0);
            });

            it("should see its own uncommitted writes inside the transaction", async () => {
                await users.runInTransaction(async tx => {
                    await users.create({ email: "a@mail.com" }, { db: tx });

                    await expect(users.count({}, { db: tx })).resolves.toBe(1);
                });

                await expect(users.count()).resolves.toBe(1);
            });

            if (capabilities.isolatedReadsDuringTransaction) {
                it("should not expose uncommitted writes to reads outside the transaction", async () => {
                    await users.runInTransaction(async tx => {
                        await users.create({ email: "a@mail.com" }, { db: tx });

                        await expect(users.count()).resolves.toBe(0);
                    });
                });
            }

            it("should make saveMany participate in an outer transaction", async () => {
                const failing = users.runInTransaction(async tx => {
                    await users.saveMany([{ email: "a@mail.com" }, { email: "b@mail.com" }], { db: tx });
                    throw new Error("rollback everything");
                });

                await expect(failing).rejects.toBeInstanceOf(VSRepoAdapterError);
                await expect(prisma.user.count()).resolves.toBe(0);
            });

            it("should make deleteManyReturning participate in an outer transaction", async () => {
                await seedDirectory();

                const failing = users.runInTransaction(async tx => {
                    await users.deleteManyReturning({ balance: { lte: 20 } }, { db: tx });
                    throw new Error("rollback everything");
                });

                await expect(failing).rejects.toBeInstanceOf(VSRepoAdapterError);
                await expect(prisma.user.count()).resolves.toBe(5);
            });

            it("should make a raw query participate in the transaction", async () => {
                await seedUser({ balance: 1 });

                const failing = users.runInTransaction(async tx => {
                    await users.query(`UPDATE ${quote("User")} SET ${quote("balance")} = 99`, {
                        modifying: true,
                        db: tx,
                    });
                    throw new Error("rollback");
                });

                await expect(failing).rejects.toBeInstanceOf(VSRepoAdapterError);
                expect((await prisma.user.findFirst()).balance).toBe(1);
            });
        });

        describe("error mapping", () => {
            it("should map a unique violation to UNIQUE_CONSTRAINT_VIOLATION", async () => {
                await seedUser({ email: "taken@mail.com" });

                const error = await users.create({ email: "taken@mail.com" }).catch(e => e);

                expect(error).toBeInstanceOf(VSRepoAdapterError);
                expect(error.code).toBe(AdapterErrorCode.UNIQUE_CONSTRAINT_VIOLATION);
                expect(error.originalError).toBeDefined();
            });

            it("should map a foreign key violation to FOREIGN_KEY_VIOLATION", async () => {
                await expect(posts.create({ title: "orphan", authorId: 987654 })).rejects.toMatchObject({
                    code: AdapterErrorCode.FOREIGN_KEY_VIOLATION,
                });
            });

            it("should map invalid data to INVALID_DATA", async () => {
                await expect(users.create({ email: 123 as any })).rejects.toMatchObject({
                    code: AdapterErrorCode.INVALID_DATA,
                });
            });
        });
    });
}
