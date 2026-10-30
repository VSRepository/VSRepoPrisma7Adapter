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

            it("should resolve to connectOrCreate on update when restriction is 'add'", () => {
                const result = parsePrismaWriteData({ address }, "id", relations({ address: rel("mto", "add") }));

                expect(result.update).toEqual({ address: { connectOrCreate } });
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
                const set = parsePrismaWriteData({ address: nullPk }, "id", relations({ address: rel("mto", "set") }));

                expect(add.create).toEqual({ address: { connectOrCreate: connectOrCreateNull } });
                expect(add.update).toEqual({ address: { connectOrCreate: connectOrCreateNull } });
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
});
