import { AdapterErrorCode, VSRepoAdapterError } from "vsrepo";
import { AdapterRelations } from "../types/adapter-relations.type.js";
import { Relation } from "../types/relation.type.js";
import { parsePrismaWriteData } from "./data.parser.js";

interface Address {
    id: string;
    street: string;
}

interface Post {
    id: string;
    title: string;
}

interface Tag {
    code: string;
    name: string;
}

interface User {
    id: string;
    name: string;
    age: number;
    address: Address | null;
    profile: Address | null;
    posts: Post[];
    tags: Tag[];
}

function relations(config: Record<string, Relation<any>>): AdapterRelations<User> {
    return config as unknown as AdapterRelations<User>;
}

function rel(
    mode: Relation["mode"],
    restriction: Relation["restriction"],
    extra: Partial<Relation> = {},
): Relation<any> {
    return { mode, restriction, pk: "id", ...extra };
}

/** Relation whose FK lives in the entity itself (e.g. `Address.user`, with `Address.userId`). */
function ownerRel(fkHere: string, extra: Partial<Relation> = {}): Relation<any> {
    return rel("mto", "add", { fkHere, ...extra });
}

describe("parsePrismaWriteData", () => {
    describe("plain fields", () => {
        it("should return empty create/update for an empty object", () => {
            expect(parsePrismaWriteData({}, "id")).toEqual({ create: {}, update: {} });
        });

        it("should copy plain fields to both create and update", () => {
            const result = parsePrismaWriteData({ name: "John", age: 30 }, "id");

            expect(result).toEqual({
                create: { name: "John", age: 30 },
                update: { name: "John", age: 30 },
            });
        });

        it("should skip undefined fields", () => {
            const result = parsePrismaWriteData({ name: "John", age: undefined }, "id");

            expect(result.create).toEqual({ name: "John" });
            expect(result.update).toEqual({ name: "John" });
        });

        it("should keep null values", () => {
            const result = parsePrismaWriteData({ name: null }, "id");

            expect(result).toEqual({ create: { name: null }, update: { name: null } });
        });

        it("should include the pk in update by default", () => {
            const result = parsePrismaWriteData({ id: "1", name: "John" }, "id");

            expect(result.create).toEqual({ id: "1", name: "John" });
            expect(result.update).toEqual({ id: "1", name: "John" });
        });

        it("should omit the pk in update when omitPkInUpdate is true", () => {
            const result = parsePrismaWriteData({ id: "1", name: "John" }, "id", undefined, true);

            expect(result.create).toEqual({ id: "1", name: "John" });
            expect(result.update).toEqual({ name: "John" });
        });

        it("should only omit the field named as pk in update", () => {
            const result = parsePrismaWriteData({ id: "1", code: "abc" }, "code", undefined, true);

            expect(result.create).toEqual({ id: "1", code: "abc" });
            expect(result.update).toEqual({ id: "1" });
        });

        it("should pass relation fields through when no relations config is given", () => {
            const posts = [{ id: "1", title: "A" }];

            const result = parsePrismaWriteData({ name: "John", posts }, "id");

            expect(result.create).toEqual({ name: "John", posts });
            expect(result.update).toEqual({ name: "John", posts });
        });

        it("should pass through fields that are not configured as relations", () => {
            const result = parsePrismaWriteData(
                { name: "John", posts: [{ title: "A" }] },
                "id",
                relations({ address: rel("mto", "add") }),
            );

            expect(result.create).toEqual({ name: "John", posts: [{ title: "A" }] });
            expect(result.update).toEqual({ name: "John", posts: [{ title: "A" }] });
        });

        it("should keep Date values by reference", () => {
            const date = new Date("2026-01-01T00:00:00.000Z");

            const result = parsePrismaWriteData({ createdAt: date }, "id");

            expect(result.create.createdAt).toBe(date);
            expect(result.update.createdAt).toBe(date);
        });
    });

    describe("to-one relations (oto / mto)", () => {
        describe("null value", () => {
            it("should throw INVALID_DATA when the relation is not nullable", () => {
                const parse = () =>
                    parsePrismaWriteData({ address: null }, "id", relations({ address: rel("mto", "add") }));

                expect(parse).toThrow(VSRepoAdapterError);

                try {
                    parse();
                } catch (error) {
                    expect((error as VSRepoAdapterError).code).toBe(AdapterErrorCode.INVALID_DATA);
                }
            });

            it("should throw when nullable is explicitly false", () => {
                const parse = () =>
                    parsePrismaWriteData(
                        { profile: null },
                        "id",
                        relations({ profile: rel("oto", "set", { nullable: false }) }),
                    );

                expect(parse).toThrow(VSRepoAdapterError);
            });

            it("should resolve to delete on update for a nullable oto with restriction 'set'", () => {
                const result = parsePrismaWriteData(
                    { profile: null },
                    "id",
                    relations({ profile: rel("oto", "set", { nullable: true }) }),
                );

                expect(result.update).toEqual({ profile: { delete: true } });
            });

            it("should resolve to disconnect on update for a nullable oto with restriction 'add'", () => {
                const result = parsePrismaWriteData(
                    { profile: null },
                    "id",
                    relations({ profile: rel("oto", "add", { nullable: true }) }),
                );

                expect(result.update).toEqual({ profile: { disconnect: true } });
            });

            it.each(["add", "set"] as const)(
                "should resolve to disconnect on update for a nullable mto with restriction '%s'",
                restriction => {
                    const result = parsePrismaWriteData(
                        { address: null },
                        "id",
                        relations({ address: rel("mto", restriction, { nullable: true }) }),
                    );

                    expect(result.update).toEqual({ address: { disconnect: true } });
                },
            );

            it.each([
                ["oto", "set"],
                ["oto", "add"],
                ["mto", "set"],
                ["mto", "add"],
            ] as const)("should not set the field in create for a null %s/%s relation", (mode, restriction) => {
                const result = parsePrismaWriteData(
                    { address: null },
                    "id",
                    relations({ address: rel(mode, restriction, { nullable: true }) }),
                );

                expect(result.create).not.toHaveProperty("address");
            });
        });

        describe("without pk (new related record)", () => {
            const address = { street: "Rua A" };

            it("should resolve to create on create", () => {
                const result = parsePrismaWriteData({ address }, "id", relations({ address: rel("mto", "add") }));

                expect(result.create).toEqual({ address: { create: address } });
            });

            it("should resolve to create on update when restriction is 'add'", () => {
                const result = parsePrismaWriteData({ address }, "id", relations({ address: rel("mto", "add") }));

                expect(result.update).toEqual({ address: { create: address } });
            });

            it("should resolve to upsert on update when restriction is 'set'", () => {
                const result = parsePrismaWriteData({ address }, "id", relations({ address: rel("mto", "set") }));

                expect(result.update).toEqual({ address: { upsert: { create: address, update: address } } });
            });

            it("should treat an undefined pk the same as a missing pk", () => {
                const result = parsePrismaWriteData(
                    { address: { id: undefined, street: "Rua A" } },
                    "id",
                    relations({ address: rel("oto", "add") }),
                );

                expect(result.create).toEqual({ address: { create: { id: undefined, street: "Rua A" } } });
            });

            it("should behave the same for oto and mto", () => {
                const asOto = parsePrismaWriteData({ address }, "id", relations({ address: rel("oto", "set") }));
                const asMto = parsePrismaWriteData({ address }, "id", relations({ address: rel("mto", "set") }));

                expect(asOto).toEqual(asMto);
            });
        });

        describe("with pk (existing related record)", () => {
            const address = { id: "10", street: "Rua A" };
            const connectOrCreate = { where: { id: "10" }, create: address };

            it("should resolve to connectOrCreate on create", () => {
                const result = parsePrismaWriteData({ address }, "id", relations({ address: rel("mto", "add") }));

                expect(result.create).toEqual({ address: { connectOrCreate } });
            });

            it("should resolve to connectOrCreate on update when restriction is 'add' and mode is 'mto'", () => {
                const result = parsePrismaWriteData({ address }, "id", relations({ address: rel("mto", "add") }));

                expect(result.update).toEqual({ address: { connectOrCreate } });
            });

            it("should resolve to upsert with an empty update on update when restriction is 'add' and mode is 'oto'", () => {
                const result = parsePrismaWriteData({ address }, "id", relations({ address: rel("oto", "add") }));

                expect(result.update).toEqual({
                    address: { upsert: { where: { id: "10" }, create: address, update: {} } },
                });
            });

            it("should default to the 'add' resolution when restriction is omitted", () => {
                const asMto = parsePrismaWriteData(
                    { address },
                    "id",
                    relations({ address: { mode: "mto", pk: "id" } }),
                );
                const asOto = parsePrismaWriteData(
                    { address },
                    "id",
                    relations({ address: { mode: "oto", pk: "id" } }),
                );

                expect(asMto.update).toEqual({ address: { connectOrCreate } });
                expect(asOto.update).toEqual({
                    address: { upsert: { where: { id: "10" }, create: address, update: {} } },
                });
            });

            it("should resolve to upsert on update when restriction is 'set', for oto and mto alike", () => {
                const asMto = parsePrismaWriteData({ address }, "id", relations({ address: rel("mto", "set") }));
                const asOto = parsePrismaWriteData({ address }, "id", relations({ address: rel("oto", "set") }));

                expect(asMto.update).toEqual(asOto.update);
                expect(asMto.update.address).toHaveProperty("upsert");
            });

            it("should resolve to upsert (without pk in update) on update when restriction is 'set'", () => {
                const result = parsePrismaWriteData({ address }, "id", relations({ address: rel("mto", "set") }));

                expect(result.update).toEqual({
                    address: {
                        upsert: {
                            where: { id: "10" },
                            create: address,
                            update: { street: "Rua A" },
                        },
                    },
                });
            });

            it("should use relation.pk (not the entity pk) to read the related pk", () => {
                const tag = { code: "x", name: "Tag" };

                const result = parsePrismaWriteData(
                    { address: tag },
                    "id",
                    relations({ address: rel("mto", "set", { pk: "code" }) }),
                );

                expect(result.create).toEqual({
                    address: { connectOrCreate: { where: { code: "x" }, create: tag } },
                });
                expect(result.update).toEqual({
                    address: { upsert: { where: { code: "x" }, create: tag, update: { name: "Tag" } } },
                });
            });

            it("should treat falsy but defined pks (0, empty string) as present", () => {
                const result = parsePrismaWriteData(
                    { address: { id: 0, street: "Rua A" } },
                    "id",
                    relations({ address: rel("mto", "add") }),
                );

                expect(result.create).toEqual({
                    address: { connectOrCreate: { where: { id: 0 }, create: { id: 0, street: "Rua A" } } },
                });
            });

            it("should treat a null pk as present (only undefined means absent)", () => {
                const nullPk = { id: null, street: "Rua A" };
                const connectOrCreateNull = { where: { id: null }, create: nullPk };

                const add = parsePrismaWriteData({ address: nullPk }, "id", relations({ address: rel("mto", "add") }));
                const addOto = parsePrismaWriteData(
                    { address: nullPk },
                    "id",
                    relations({ address: rel("oto", "add") }),
                );
                const set = parsePrismaWriteData({ address: nullPk }, "id", relations({ address: rel("mto", "set") }));

                expect(add.create).toEqual({ address: { connectOrCreate: connectOrCreateNull } });
                expect(add.update).toEqual({ address: { connectOrCreate: connectOrCreateNull } });
                expect(addOto.update).toEqual({
                    address: { upsert: { where: { id: null }, create: nullPk, update: {} } },
                });
                expect(set.update).toEqual({
                    address: { upsert: { where: { id: null }, create: nullPk, update: { street: "Rua A" } } },
                });
            });

            it("should not mutate the original related object", () => {
                const original = { id: "10", street: "Rua A" };

                parsePrismaWriteData({ address: original }, "id", relations({ address: rel("mto", "set") }));

                expect(original).toEqual({ id: "10", street: "Rua A" });
            });
        });
    });

    describe("to-many relations (otm / mtm)", () => {
        const withPk = { id: "1", title: "A" };
        const withoutPk = { title: "B" };

        describe("create", () => {
            it.each([
                ["otm", "add"],
                ["otm", "set"],
                ["mtm", "add"],
                ["mtm", "set"],
            ] as const)("should split items into create/connectOrCreate for %s/%s", (mode, restriction) => {
                const result = parsePrismaWriteData(
                    { posts: [withPk, withoutPk] },
                    "id",
                    relations({ posts: rel(mode, restriction) }),
                );

                expect(result.create).toEqual({
                    posts: {
                        create: [withoutPk],
                        connectOrCreate: [{ where: { id: "1" }, create: withPk }],
                    },
                });
            });
        });

        describe("otm", () => {
            it("should resolve update to create + upsert when restriction is 'add'", () => {
                const result = parsePrismaWriteData(
                    { posts: [withPk, withoutPk] },
                    "id",
                    relations({ posts: rel("otm", "add") }),
                );

                expect(result.update).toEqual({
                    posts: {
                        create: [withoutPk],
                        upsert: [{ where: { id: "1" }, create: withPk, update: { title: "A" } }],
                    },
                });
            });

            it("should resolve update to deleteMany + create + upsert when restriction is 'set'", () => {
                const result = parsePrismaWriteData(
                    { posts: [withPk, withoutPk] },
                    "id",
                    relations({ posts: rel("otm", "set") }),
                );

                expect(result.update).toEqual({
                    posts: {
                        deleteMany: { id: { notIn: ["1"] } },
                        create: [withoutPk],
                        upsert: [{ where: { id: "1" }, create: withPk, update: { title: "A" } }],
                    },
                });
            });

            it("should list every pk in deleteMany.notIn", () => {
                const result = parsePrismaWriteData(
                    { posts: [{ id: "1", title: "A" }, { id: "2", title: "B" }, withoutPk] },
                    "id",
                    relations({ posts: rel("otm", "set") }),
                );

                expect(result.update.posts.deleteMany).toEqual({ id: { notIn: ["1", "2"] } });
            });

            it("should delete everything not sent when restriction is 'set' and the array is empty", () => {
                const result = parsePrismaWriteData({ posts: [] }, "id", relations({ posts: rel("otm", "set") }));

                expect(result.update).toEqual({
                    posts: { deleteMany: { id: { notIn: [] } }, create: [], upsert: [] },
                });
            });

            it("should not include deleteMany when restriction is 'add' and the array is empty", () => {
                const result = parsePrismaWriteData({ posts: [] }, "id", relations({ posts: rel("otm", "add") }));

                expect(result.update).toEqual({ posts: { create: [], upsert: [] } });
            });

            it("should only create when no item has a pk", () => {
                const result = parsePrismaWriteData(
                    { posts: [{ title: "A" }, { title: "B" }] },
                    "id",
                    relations({ posts: rel("otm", "add") }),
                );

                expect(result.create).toEqual({
                    posts: { create: [{ title: "A" }, { title: "B" }], connectOrCreate: [] },
                });
                expect(result.update).toEqual({
                    posts: { create: [{ title: "A" }, { title: "B" }], upsert: [] },
                });
            });

            it("should use relation.pk to split items and build where/deleteMany", () => {
                const tagWithPk = { code: "x", name: "X" };
                const tagWithoutPk = { name: "Y" };

                const result = parsePrismaWriteData(
                    { tags: [tagWithPk, tagWithoutPk] },
                    "id",
                    relations({ tags: rel("otm", "set", { pk: "code" }) }),
                );

                expect(result.create).toEqual({
                    tags: { create: [tagWithoutPk], connectOrCreate: [{ where: { code: "x" }, create: tagWithPk }] },
                });
                expect(result.update).toEqual({
                    tags: {
                        deleteMany: { code: { notIn: ["x"] } },
                        create: [tagWithoutPk],
                        upsert: [{ where: { code: "x" }, create: tagWithPk, update: { name: "X" } }],
                    },
                });
            });

            it("should treat a null pk as present (only undefined means absent)", () => {
                const nullPk = { id: null, title: "A" };

                const result = parsePrismaWriteData({ posts: [nullPk] }, "id", relations({ posts: rel("otm", "add") }));

                expect(result.create).toEqual({
                    posts: { create: [], connectOrCreate: [{ where: { id: null }, create: nullPk }] },
                });
                expect(result.update).toEqual({
                    posts: {
                        create: [],
                        upsert: [{ where: { id: null }, create: nullPk, update: { title: "A" } }],
                    },
                });
            });

            it("should preserve the order of items", () => {
                const result = parsePrismaWriteData(
                    {
                        posts: [
                            { id: "3", title: "C" },
                            { id: "1", title: "A" },
                            { id: "2", title: "B" },
                        ],
                    },
                    "id",
                    relations({ posts: rel("otm", "add") }),
                );

                expect(result.update.posts.upsert.map((u: any) => u.where.id)).toEqual(["3", "1", "2"]);
            });
        });

        describe("mtm", () => {
            it("should resolve update to create + connectOrCreate when restriction is 'add'", () => {
                const result = parsePrismaWriteData(
                    { posts: [withPk, withoutPk] },
                    "id",
                    relations({ posts: rel("mtm", "add") }),
                );

                expect(result.update).toEqual({
                    posts: {
                        create: [withoutPk],
                        connectOrCreate: [{ where: { id: "1" }, create: withPk }],
                    },
                });
            });

            it("should resolve update to set [] + create + connectOrCreate when restriction is 'set'", () => {
                const result = parsePrismaWriteData(
                    { posts: [withPk, withoutPk] },
                    "id",
                    relations({ posts: rel("mtm", "set") }),
                );

                expect(result.update).toEqual({
                    posts: {
                        set: [],
                        create: [withoutPk],
                        connectOrCreate: [{ where: { id: "1" }, create: withPk }],
                    },
                });
            });

            it("should disconnect everything when restriction is 'set' and the array is empty", () => {
                const result = parsePrismaWriteData({ posts: [] }, "id", relations({ posts: rel("mtm", "set") }));

                expect(result.update).toEqual({ posts: { set: [], create: [], connectOrCreate: [] } });
            });

            it("should never use upsert or deleteMany", () => {
                const result = parsePrismaWriteData(
                    { posts: [withPk, withoutPk] },
                    "id",
                    relations({ posts: rel("mtm", "set") }),
                );

                expect(result.update.posts).not.toHaveProperty("upsert");
                expect(result.update.posts).not.toHaveProperty("deleteMany");
            });
        });

        it("should not mutate the original items", () => {
            const original = [{ id: "1", title: "A" }, { title: "B" }];
            const snapshot = JSON.parse(JSON.stringify(original));

            parsePrismaWriteData({ posts: original }, "id", relations({ posts: rel("otm", "set") }));

            expect(original).toEqual(snapshot);
        });
    });

    describe("mixed payloads", () => {
        it("should handle plain fields and several relations together", () => {
            const result = parsePrismaWriteData(
                {
                    id: "1",
                    name: "John",
                    address: { id: "10", street: "Rua A" },
                    posts: [{ title: "A" }],
                    tags: [{ code: "x", name: "X" }],
                },
                "id",
                relations({
                    address: rel("mto", "add"),
                    posts: rel("otm", "add"),
                    tags: rel("mtm", "add", { pk: "code" }),
                }),
                true,
            );

            expect(result.create).toEqual({
                id: "1",
                name: "John",
                address: { connectOrCreate: { where: { id: "10" }, create: { id: "10", street: "Rua A" } } },
                posts: { create: [{ title: "A" }], connectOrCreate: [] },
                tags: {
                    create: [],
                    connectOrCreate: [{ where: { code: "x" }, create: { code: "x", name: "X" } }],
                },
            });

            expect(result.update).toEqual({
                name: "John",
                address: { connectOrCreate: { where: { id: "10" }, create: { id: "10", street: "Rua A" } } },
                posts: { create: [{ title: "A" }], upsert: [] },
                tags: {
                    create: [],
                    connectOrCreate: [{ where: { code: "x" }, create: { code: "x", name: "X" } }],
                },
            });
        });

        it("should skip undefined relation fields", () => {
            const result = parsePrismaWriteData(
                { name: "John", posts: undefined, address: undefined },
                "id",
                relations({ posts: rel("otm", "set"), address: rel("mto", "set") }),
            );

            expect(result).toEqual({ create: { name: "John" }, update: { name: "John" } });
        });

        it("should not apply omitPkInUpdate to relation fields", () => {
            const result = parsePrismaWriteData(
                { id: "1", posts: [{ id: "2", title: "A" }] },
                "id",
                relations({ posts: rel("otm", "add") }),
                true,
            );

            expect(result.update).not.toHaveProperty("id");
            expect(result.update.posts.upsert[0].where).toEqual({ id: "2" });
        });
    });

    describe("default restriction", () => {
        const address = { street: "Rua A" };

        it("should default to 'add' for a to-one relation when restriction is omitted", () => {
            const result = parsePrismaWriteData({ address }, "id", relations({ address: { mode: "mto", pk: "id" } }));

            expect(result.update).toEqual({ address: { create: address } });
        });

        it("should default to 'add' for a to-many relation when restriction is omitted", () => {
            const result = parsePrismaWriteData(
                { posts: [{ id: "1", title: "A" }] },
                "id",
                relations({ posts: { mode: "otm", pk: "id" } }),
            );

            expect(result.update.posts).not.toHaveProperty("deleteMany");
        });

        it("should default to 'add' when sending null to a nullable oto", () => {
            const result = parsePrismaWriteData(
                { address: null },
                "id",
                relations({ address: { mode: "oto", pk: "id", nullable: true } }),
            );

            expect(result.update).toEqual({ address: { disconnect: true } });
        });
    });

    describe("fkThere (FK in the related entity)", () => {
        it("should strip fkThere from a to-one payload without pk", () => {
            const result = parsePrismaWriteData(
                { address: { street: "Rua A", userId: "1" } },
                "id",
                relations({ address: rel("oto", "add", { fkThere: "userId" }) }),
            );

            expect(result.create).toEqual({ address: { create: { street: "Rua A" } } });
            expect(result.update).toEqual({ address: { create: { street: "Rua A" } } });
        });

        it("should strip fkThere from a to-one payload with pk", () => {
            const result = parsePrismaWriteData(
                { address: { id: "10", street: "Rua A", userId: "1" } },
                "id",
                relations({ address: rel("oto", "set", { fkThere: "userId" }) }),
            );
            const address = { id: "10", street: "Rua A" };

            expect(result.create).toEqual({ address: { connectOrCreate: { where: { id: "10" }, create: address } } });
            expect(result.update).toEqual({
                address: { upsert: { where: { id: "10" }, create: address, update: { street: "Rua A" } } },
            });
        });

        it("should strip fkThere from every item of a to-many payload", () => {
            const result = parsePrismaWriteData(
                {
                    posts: [
                        { id: "1", title: "A", authorId: "1" },
                        { title: "B", authorId: "1" },
                    ],
                },
                "id",
                relations({ posts: rel("otm", "add", { fkThere: "authorId" }) }),
            );

            expect(result.create.posts).toEqual({
                create: [{ title: "B" }],
                connectOrCreate: [{ where: { id: "1" }, create: { id: "1", title: "A" } }],
            });
            expect(result.update.posts).toEqual({
                create: [{ title: "B" }],
                upsert: [{ where: { id: "1" }, create: { id: "1", title: "A" }, update: { title: "A" } }],
            });
        });

        it("should not mutate the original related payload", () => {
            const address = { street: "Rua A", userId: "1" };

            parsePrismaWriteData({ address }, "id", relations({ address: rel("oto", "add", { fkThere: "userId" }) }));

            expect(address).toEqual({ street: "Rua A", userId: "1" });
        });

        it("should not require allowOmitPk nor touch the primary key", () => {
            const result = parsePrismaWriteData(
                { id: "1", address: { street: "Rua A", userId: "1" } },
                "id",
                relations({ address: rel("oto", "add", { fkThere: "userId" }) }),
            );

            expect(result.create).toHaveProperty("id", "1");
            expect(result.update).toHaveProperty("id", "1");
        });
    });

    describe("fkHere (FK in the entity itself)", () => {
        const user = { email: "a@a.com", name: "A" };

        it("should drop the fkHere field from create and update when the relation is in the payload", () => {
            const result = parsePrismaWriteData(
                { street: "Rua A", userId: "1", user },
                "id",
                relations({ user: ownerRel("userId") }),
            );

            expect(result.create).toEqual({ street: "Rua A", user: { create: user } });
            expect(result.update).toEqual({ street: "Rua A", user: { create: user } });
        });

        it("should drop fkHere even when the relation comes before it in the payload", () => {
            const result = parsePrismaWriteData({ user, userId: "1" }, "id", relations({ user: ownerRel("userId") }));

            expect(result.create).not.toHaveProperty("userId");
            expect(result.update).not.toHaveProperty("userId");
        });

        it("should keep the fkHere field when the relation is not in the payload", () => {
            const result = parsePrismaWriteData(
                { id: "1", street: "Rua A", userId: "1" },
                "id",
                relations({ user: ownerRel("userId") }),
            );

            expect(result.create).toEqual({ id: "1", street: "Rua A", userId: "1" });
            expect(result.update).toEqual({ id: "1", street: "Rua A", userId: "1" });
        });

        it("should keep the fkHere field when the relation is undefined", () => {
            const result = parsePrismaWriteData(
                { street: "Rua A", userId: "1", user: undefined },
                "id",
                relations({ user: ownerRel("userId") }),
            );

            expect(result.create).toEqual({ street: "Rua A", userId: "1" });
        });

        it("should drop every fkHere field when there are several owner relations", () => {
            const result = parsePrismaWriteData(
                { userId: "1", user, groupId: "2", group: { name: "G" } },
                "id",
                relations({ user: ownerRel("userId"), group: ownerRel("groupId") }),
            );

            expect(Object.keys(result.create).sort()).toEqual(["group", "user"]);
            expect(Object.keys(result.update).sort()).toEqual(["group", "user"]);
        });

        describe("primary key", () => {
            const payload = { id: "114", street: "Rua A", userId: "1", user: { id: "1", ...user } };
            const config = relations({ user: ownerRel("userId") });

            it("should throw INVALID_DATA when the payload has the pk and allowOmitPk is not enabled", () => {
                expect(() => parsePrismaWriteData(payload, "id", config)).toThrow(VSRepoAdapterError);
                expect(() => parsePrismaWriteData(payload, "id", config)).toThrow(
                    expect.objectContaining({ code: AdapterErrorCode.INVALID_DATA }),
                );
            });

            it("should explain the problem and how to solve it in the error message", () => {
                expect(() => parsePrismaWriteData(payload, "id", config)).toThrow(
                    /primary key 'id'.*'user'.*allowOmitPk.*setGlobalConfig.*database-generated/s,
                );
            });

            it("should list every owner relation in the error message", () => {
                const both = { ...payload, group: { name: "G" } };
                const bothConfig = relations({ user: ownerRel("userId"), group: ownerRel("groupId") });

                expect(() => parsePrismaWriteData(both, "id", bothConfig)).toThrow(/'user', 'group'/);
            });

            it("should throw even when omitPkInUpdate is true (the pk is still in create)", () => {
                expect(() => parsePrismaWriteData(payload, "id", config, true)).toThrow(VSRepoAdapterError);
            });

            it("should throw when the owner relation is null and the pk is present", () => {
                const nullable = relations({ user: ownerRel("userId", { nullable: true }) });

                expect(() => parsePrismaWriteData({ id: "114", user: null }, "id", nullable)).toThrow(
                    expect.objectContaining({ code: AdapterErrorCode.INVALID_DATA }),
                );
            });

            it("should not throw when the payload has no pk", () => {
                const { id: _id, ...withoutPk } = payload;

                expect(() => parsePrismaWriteData(withoutPk, "id", config)).not.toThrow();
            });

            it("should not throw when the pk is undefined", () => {
                expect(() => parsePrismaWriteData({ ...payload, id: undefined }, "id", config)).not.toThrow();
            });

            it("should not throw when the pk is present but the owner relation is not in the payload", () => {
                const result = parsePrismaWriteData({ id: "114", street: "Rua A", userId: "1" }, "id", config);

                expect(result.create).toEqual({ id: "114", street: "Rua A", userId: "1" });
            });

            it("should drop the pk and the fkHere field from create and update when allowOmitPk is enabled", () => {
                const result = parsePrismaWriteData(payload, "id", config, false, true);

                expect(result.create).toEqual({
                    street: "Rua A",
                    user: { connectOrCreate: { where: { id: "1" }, create: { id: "1", ...user } } },
                });
                expect(result.update).toEqual({
                    street: "Rua A",
                    user: { connectOrCreate: { where: { id: "1" }, create: { id: "1", ...user } } },
                });
            });

            it("should drop the pk from create (and keep it out of update) with omitPkInUpdate and allowOmitPk", () => {
                const result = parsePrismaWriteData(payload, "id", config, true, true);

                expect(result.create).not.toHaveProperty("id");
                expect(result.update).not.toHaveProperty("id");
                expect(result.create).not.toHaveProperty("userId");
            });

            it("should only drop the entity pk, not the pk of the related record", () => {
                const result = parsePrismaWriteData(payload, "id", config, false, true);

                expect(result.create.user.connectOrCreate.where).toEqual({ id: "1" });
                expect(result.create.user.connectOrCreate.create).toHaveProperty("id", "1");
            });

            it("should not mutate the original payload", () => {
                const original = { ...payload };

                parsePrismaWriteData(original, "id", config, false, true);

                expect(original).toEqual(payload);
            });
        });
    });
});
