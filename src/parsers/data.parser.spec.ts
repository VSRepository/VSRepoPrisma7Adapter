import { AdapterErrorCode, VSRepoAdapterError } from "vsrepo";
import { AdapterRelations } from "../types/adapter-relations.type.js";
import type { Relation, RelationMode, ToManyStrategy, ToOneStrategy } from "../types/relation.type.js";
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

/**
 * Builds a relation config. The spec exercises runtime branches (including
 * combinations the types forbid), so it is deliberately loose; the type-level
 * rules are covered in `relation.type.spec.ts`.
 */
function rel(
    mode: RelationMode,
    onUpdate?: ToOneStrategy | ToManyStrategy,
    extra: Record<string, unknown> = {},
): Relation<any> {
    return { mode, pk: "id", ...(onUpdate !== undefined && { onUpdate }), ...extra } as Relation<any>;
}

const TO_ONE_STRATEGIES = ["connect", "connectOrCreate", "upsert"] as const;

/** Relation whose FK lives in the entity itself (e.g. `Address.user`, with `Address.userId`). */
function ownerRel(fkHere: string, extra: Record<string, unknown> = {}): Relation<any> {
    return rel("mto", undefined, { fkHere, ...extra });
}

/**
 * Runs `parsePrismaWriteData` with `knownKeys` defaulting to every key of the
 * payload plus the configured relations, so a test only deals with the
 * filtering of unknown keys when it passes `knownKeys` explicitly.
 */
function parse(
    obj: Record<string, unknown>,
    pkName: string,
    relationsConfig?: AdapterRelations<User>,
    omitPkInUpdate?: boolean,
    allowOmitPkWhenNeeded?: boolean,
    knownKeys: ReadonlySet<string> = new Set([...Object.keys(obj), ...Object.keys(relationsConfig ?? {})]),
) {
    return parsePrismaWriteData(obj, pkName, knownKeys, relationsConfig, omitPkInUpdate, allowOmitPkWhenNeeded);
}

describe("parsePrismaWriteData", () => {
    describe("plain fields", () => {
        it("should return empty create/update for an empty object", () => {
            expect(parse({}, "id")).toEqual({ create: {}, update: {} });
        });

        it("should copy plain fields to both create and update", () => {
            const result = parse({ name: "John", age: 30 }, "id");

            expect(result).toEqual({
                create: { name: "John", age: 30 },
                update: { name: "John", age: 30 },
            });
        });

        it("should skip undefined fields", () => {
            const result = parse({ name: "John", age: undefined }, "id");

            expect(result.create).toEqual({ name: "John" });
            expect(result.update).toEqual({ name: "John" });
        });

        it("should keep null values", () => {
            const result = parse({ name: null }, "id");

            expect(result).toEqual({ create: { name: null }, update: { name: null } });
        });

        it("should include the pk in update by default", () => {
            const result = parse({ id: "1", name: "John" }, "id");

            expect(result.create).toEqual({ id: "1", name: "John" });
            expect(result.update).toEqual({ id: "1", name: "John" });
        });

        it("should omit the pk in update when omitPkInUpdate is true", () => {
            const result = parse({ id: "1", name: "John" }, "id", undefined, true);

            expect(result.create).toEqual({ id: "1", name: "John" });
            expect(result.update).toEqual({ name: "John" });
        });

        it("should only omit the field named as pk in update", () => {
            const result = parse({ id: "1", code: "abc" }, "code", undefined, true);

            expect(result.create).toEqual({ id: "1", code: "abc" });
            expect(result.update).toEqual({ id: "1" });
        });

        it("should drop fields that are not in knownKeys", () => {
            const result = parse(
                { name: "John", posts: [{ id: "1", title: "A" }] },
                "id",
                undefined,
                false,
                false,
                new Set(["name"]),
            );

            expect(result).toEqual({ create: { name: "John" }, update: { name: "John" } });
        });

        it("should drop a relation field that is neither a model field nor configured in relations", () => {
            const result = parse(
                { name: "John", posts: [{ title: "A" }] },
                "id",
                relations({ address: rel("mto") }),
                false,
                false,
                new Set(["name", "address"]),
            );

            expect(result.create).toEqual({ name: "John" });
            expect(result.update).toEqual({ name: "John" });
        });

        it("should keep Date values by reference", () => {
            const date = new Date("2026-01-01T00:00:00.000Z");

            const result = parse({ createdAt: date }, "id");

            expect(result.create.createdAt).toBe(date);
            expect(result.update.createdAt).toBe(date);
        });
    });

    describe("to-one relations (oto / mto)", () => {
        describe("null value", () => {
            it.each(["oto", "mto"] as const)("should resolve to disconnect on update by default for %s", mode => {
                const result = parse({ address: null }, "id", relations({ address: rel(mode) }));

                expect(result.update).toEqual({ address: { disconnect: true } });
            });

            it("should resolve to disconnect on update when onDisconnect is 'disconnect'", () => {
                const result = parse(
                    { profile: null },
                    "id",
                    relations({ profile: rel("oto", undefined, { onDisconnect: "disconnect" }) }),
                );

                expect(result.update).toEqual({ profile: { disconnect: true } });
            });

            it("should resolve to delete on update for an oto when onDisconnect is 'delete'", () => {
                const result = parse(
                    { profile: null },
                    "id",
                    relations({ profile: rel("oto", undefined, { onDisconnect: "delete" }) }),
                );

                expect(result.update).toEqual({ profile: { delete: true } });
            });

            it("should resolve to delete on update for an mto when onDisconnect is 'delete'", () => {
                const result = parse(
                    { address: null },
                    "id",
                    relations({ address: rel("mto", undefined, { onDisconnect: "delete" }) }),
                );

                expect(result.update).toEqual({ address: { delete: true } });
            });

            it("should keep disconnecting an mto by default and when onDisconnect is 'disconnect'", () => {
                const byDefault = parse({ address: null }, "id", relations({ address: rel("mto") }));
                const explicit = parse(
                    { address: null },
                    "id",
                    relations({ address: rel("mto", undefined, { onDisconnect: "disconnect" }) }),
                );

                expect(byDefault.update).toEqual({ address: { disconnect: true } });
                expect(explicit.update).toEqual({ address: { disconnect: true } });
            });

            it("should not depend on onUpdate to resolve null", () => {
                const result = parse(
                    { profile: null },
                    "id",
                    relations({ profile: rel("oto", "upsert", { onDisconnect: "delete" }) }),
                );

                expect(result.update).toEqual({ profile: { delete: true } });
            });

            it.each([
                ["oto", undefined],
                ["oto", "delete"],
                ["mto", undefined],
                ["mto", "delete"],
            ] as const)(
                "should not set the field in create for a null %s relation (onDisconnect: %s)",
                (mode, onDisconnect) => {
                    const result = parse(
                        { address: null },
                        "id",
                        relations({ address: rel(mode, undefined, { onDisconnect }) }),
                    );

                    expect(result.create).not.toHaveProperty("address");
                },
            );
        });

        describe("without pk (new related record)", () => {
            const address = { street: "Rua A" };

            it("should resolve to create on create", () => {
                const result = parse({ address }, "id", relations({ address: rel("mto") }));

                expect(result.create).toEqual({ address: { create: address } });
            });

            it("should resolve to create on update by default", () => {
                const result = parse({ address }, "id", relations({ address: rel("mto") }));

                expect(result.update).toEqual({ address: { create: address } });
            });

            it.each(["connect", "connectOrCreate"] as const)(
                "should resolve to create on update when onUpdate is '%s' (nothing to connect to)",
                onUpdate => {
                    const result = parse({ address }, "id", relations({ address: rel("mto", onUpdate) }));

                    expect(result.update).toEqual({ address: { create: address } });
                },
            );

            it("should resolve to upsert on update when onUpdate is 'upsert'", () => {
                const result = parse({ address }, "id", relations({ address: rel("mto", "upsert") }));

                expect(result.update).toEqual({ address: { upsert: { create: address, update: address } } });
            });

            it("should treat an undefined pk the same as a missing pk", () => {
                const result = parse(
                    { address: { id: undefined, street: "Rua A" } },
                    "id",
                    relations({ address: rel("oto") }),
                );

                expect(result.create).toEqual({ address: { create: { id: undefined, street: "Rua A" } } });
            });

            it.each([undefined, ...TO_ONE_STRATEGIES])(
                "should behave the same for oto and mto (onUpdate: %s)",
                onUpdate => {
                    const asOto = parse({ address }, "id", relations({ address: rel("oto", onUpdate) }));
                    const asMto = parse({ address }, "id", relations({ address: rel("mto", onUpdate) }));

                    expect(asOto).toEqual(asMto);
                },
            );
        });

        describe("with pk (existing related record)", () => {
            const address = { id: "10", street: "Rua A" };
            const where = { id: "10" };
            const connectOrCreate = { where, create: address };

            it.each([undefined, ...TO_ONE_STRATEGIES])(
                "should resolve to connectOrCreate on create whatever onUpdate is (%s)",
                onUpdate => {
                    const result = parse({ address }, "id", relations({ address: rel("mto", onUpdate) }));

                    expect(result.create).toEqual({ address: { connectOrCreate } });
                },
            );

            it.each(["oto", "mto"] as const)("should default onUpdate to 'connect' for %s", mode => {
                const result = parse({ address }, "id", relations({ address: rel(mode) }));

                expect(result.update).toEqual({ address: { connect: where } });
            });

            it("should only connect, without sending the related fields, when onUpdate is 'connect'", () => {
                const result = parse({ address }, "id", relations({ address: rel("oto", "connect") }));

                expect(result.update).toEqual({ address: { connect: { id: "10" } } });
            });

            it("should resolve to connectOrCreate on update when onUpdate is 'connectOrCreate'", () => {
                const result = parse({ address }, "id", relations({ address: rel("oto", "connectOrCreate") }));

                expect(result.update).toEqual({ address: { connectOrCreate } });
            });

            it.each(["oto", "mto"] as const)(
                "should resolve to upsert (without pk in update) on update when onUpdate is 'upsert' for %s",
                mode => {
                    const result = parse({ address }, "id", relations({ address: rel(mode, "upsert") }));

                    expect(result.update).toEqual({
                        address: { upsert: { where, create: address, update: { street: "Rua A" } } },
                    });
                },
            );

            it("should use relation.pk (not the entity pk) to read the related pk", () => {
                const tag = { code: "x", name: "Tag" };

                const build = (onUpdate: ToOneStrategy) =>
                    parse({ address: tag }, "id", relations({ address: rel("mto", onUpdate, { pk: "code" }) }));

                expect(build("connect").create).toEqual({
                    address: { connectOrCreate: { where: { code: "x" }, create: tag } },
                });
                expect(build("connect").update).toEqual({ address: { connect: { code: "x" } } });
                expect(build("upsert").update).toEqual({
                    address: { upsert: { where: { code: "x" }, create: tag, update: { name: "Tag" } } },
                });
            });

            it("should treat falsy but defined pks (0, empty string) as present", () => {
                const result = parse({ address: { id: 0, street: "Rua A" } }, "id", relations({ address: rel("mto") }));

                expect(result.create).toEqual({
                    address: { connectOrCreate: { where: { id: 0 }, create: { id: 0, street: "Rua A" } } },
                });
                expect(result.update).toEqual({ address: { connect: { id: 0 } } });
            });

            it("should treat a null pk as present (only undefined means absent)", () => {
                const nullPk = { id: null, street: "Rua A" };
                const nullWhere = { id: null };

                const run = (onUpdate?: ToOneStrategy) =>
                    parse({ address: nullPk }, "id", relations({ address: rel("mto", onUpdate) }));

                expect(run().create).toEqual({ address: { connectOrCreate: { where: nullWhere, create: nullPk } } });
                expect(run().update).toEqual({ address: { connect: nullWhere } });
                expect(run("connectOrCreate").update).toEqual({
                    address: { connectOrCreate: { where: nullWhere, create: nullPk } },
                });
                expect(run("upsert").update).toEqual({
                    address: { upsert: { where: nullWhere, create: nullPk, update: { street: "Rua A" } } },
                });
            });

            it.each(TO_ONE_STRATEGIES)("should not mutate the original related object (onUpdate: %s)", onUpdate => {
                const original = { id: "10", street: "Rua A" };

                parse({ address: original }, "id", relations({ address: rel("mto", onUpdate) }));

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
                const result = parse(
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
                const result = parse({ posts: [withPk, withoutPk] }, "id", relations({ posts: rel("otm", "add") }));

                expect(result.update).toEqual({
                    posts: {
                        create: [withoutPk],
                        upsert: [{ where: { id: "1" }, create: withPk, update: { title: "A" } }],
                    },
                });
            });

            it("should resolve update to deleteMany + create + upsert when restriction is 'set'", () => {
                const result = parse({ posts: [withPk, withoutPk] }, "id", relations({ posts: rel("otm", "set") }));

                expect(result.update).toEqual({
                    posts: {
                        deleteMany: { id: { notIn: ["1"] } },
                        create: [withoutPk],
                        upsert: [{ where: { id: "1" }, create: withPk, update: { title: "A" } }],
                    },
                });
            });

            it("should list every pk in deleteMany.notIn", () => {
                const result = parse(
                    { posts: [{ id: "1", title: "A" }, { id: "2", title: "B" }, withoutPk] },
                    "id",
                    relations({ posts: rel("otm", "set") }),
                );

                expect(result.update.posts.deleteMany).toEqual({ id: { notIn: ["1", "2"] } });
            });

            it("should delete everything not sent when restriction is 'set' and the array is empty", () => {
                const result = parse({ posts: [] }, "id", relations({ posts: rel("otm", "set") }));

                expect(result.update).toEqual({
                    posts: { deleteMany: { id: { notIn: [] } }, create: [], upsert: [] },
                });
            });

            it("should not include deleteMany when restriction is 'add' and the array is empty", () => {
                const result = parse({ posts: [] }, "id", relations({ posts: rel("otm", "add") }));

                expect(result.update).toEqual({ posts: { create: [], upsert: [] } });
            });

            it("should only create when no item has a pk", () => {
                const result = parse(
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

                const result = parse(
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

                const result = parse({ posts: [nullPk] }, "id", relations({ posts: rel("otm", "add") }));

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
                const result = parse(
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
                const result = parse({ posts: [withPk, withoutPk] }, "id", relations({ posts: rel("mtm", "add") }));

                expect(result.update).toEqual({
                    posts: {
                        create: [withoutPk],
                        connectOrCreate: [{ where: { id: "1" }, create: withPk }],
                    },
                });
            });

            it("should resolve update to set [] + create + connectOrCreate when restriction is 'set'", () => {
                const result = parse({ posts: [withPk, withoutPk] }, "id", relations({ posts: rel("mtm", "set") }));

                expect(result.update).toEqual({
                    posts: {
                        set: [],
                        create: [withoutPk],
                        connectOrCreate: [{ where: { id: "1" }, create: withPk }],
                    },
                });
            });

            it("should disconnect everything when restriction is 'set' and the array is empty", () => {
                const result = parse({ posts: [] }, "id", relations({ posts: rel("mtm", "set") }));

                expect(result.update).toEqual({ posts: { set: [], create: [], connectOrCreate: [] } });
            });

            it("should never use upsert or deleteMany", () => {
                const result = parse({ posts: [withPk, withoutPk] }, "id", relations({ posts: rel("mtm", "set") }));

                expect(result.update.posts).not.toHaveProperty("upsert");
                expect(result.update.posts).not.toHaveProperty("deleteMany");
            });
        });

        it("should not mutate the original items", () => {
            const original = [{ id: "1", title: "A" }, { title: "B" }];
            const snapshot = JSON.parse(JSON.stringify(original));

            parse({ posts: original }, "id", relations({ posts: rel("otm", "set") }));

            expect(original).toEqual(snapshot);
        });
    });

    describe("mixed payloads", () => {
        it("should handle plain fields and several relations together", () => {
            const result = parse(
                {
                    id: "1",
                    name: "John",
                    address: { id: "10", street: "Rua A" },
                    posts: [{ title: "A" }],
                    tags: [{ code: "x", name: "X" }],
                },
                "id",
                relations({
                    address: rel("mto"),
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
                address: { connect: { id: "10" } },
                posts: { create: [{ title: "A" }], upsert: [] },
                tags: {
                    create: [],
                    connectOrCreate: [{ where: { code: "x" }, create: { code: "x", name: "X" } }],
                },
            });
        });

        it("should skip undefined relation fields", () => {
            const result = parse(
                { name: "John", posts: undefined, address: undefined },
                "id",
                relations({ posts: rel("otm", "set"), address: rel("mto", "upsert") }),
            );

            expect(result).toEqual({ create: { name: "John" }, update: { name: "John" } });
        });

        it("should not apply omitPkInUpdate to relation fields", () => {
            const result = parse(
                { id: "1", posts: [{ id: "2", title: "A" }] },
                "id",
                relations({ posts: rel("otm", "add") }),
                true,
            );

            expect(result.update).not.toHaveProperty("id");
            expect(result.update.posts.upsert[0].where).toEqual({ id: "2" });
        });
    });

    describe("default strategies", () => {
        const address = { street: "Rua A" };

        it("should default onUpdate to 'connect' for a to-one relation", () => {
            const result = parse(
                { address: { id: "10", ...address } },
                "id",
                relations({ address: { mode: "mto", pk: "id" } }),
            );

            expect(result.update).toEqual({ address: { connect: { id: "10" } } });
        });

        it("should default onUpdate to 'connectOrCreate' for a to-one relation with fkThere", () => {
            const result = parse(
                { address: { id: "10", ...address, userId: "1" } },
                "id",
                relations({ address: { mode: "oto", pk: "id", fkThere: "userId" } as Relation<any> }),
            );

            expect(result.update).toEqual({
                address: { connectOrCreate: { where: { id: "10" }, create: { id: "10", ...address } } },
            });
        });

        it("should default onUpdate to 'connect' for a to-one relation with fkHere", () => {
            const result = parse(
                { street: "Rua A", userId: "1", user: { id: "1", name: "John" } },
                "id",
                relations({ user: { mode: "mto", pk: "id", fkHere: "userId" } as Relation<any> }),
            );

            expect(result.update).toEqual({ street: "Rua A", user: { connect: { id: "1" } } });
        });

        it("should let onUpdate win over the fkThere default", () => {
            const result = parse(
                { address: { id: "10", ...address, userId: "1" } },
                "id",
                relations({
                    address: { mode: "oto", pk: "id", fkThere: "userId", onUpdate: "connect" } as Relation<any>,
                }),
            );

            expect(result.update).toEqual({ address: { connect: { id: "10" } } });
        });

        it("should default onUpdate to 'add' for a to-many relation", () => {
            const result = parse(
                { posts: [{ id: "1", title: "A" }] },
                "id",
                relations({ posts: { mode: "otm", pk: "id" } }),
            );

            expect(result.update.posts).not.toHaveProperty("deleteMany");
        });

        it("should default onDisconnect to 'disconnect'", () => {
            const result = parse({ address: null }, "id", relations({ address: { mode: "oto", pk: "id" } }));

            expect(result.update).toEqual({ address: { disconnect: true } });
        });
    });

    describe("unknown keys", () => {
        const known = new Set(["id", "name", "street", "userId"]);

        it("should leave a non-configured relation object out of create and update", () => {
            const result = parse(
                { name: "John", address: { id: "10", street: "Rua A" }, posts: [{ title: "A" }] },
                "id",
                undefined,
                false,
                false,
                known,
            );

            expect(result).toEqual({ create: { name: "John" }, update: { name: "John" } });
        });

        it("should keep the pk and the scalar FK, without allowOmitPk, when the owner relation is not configured", () => {
            const result = parse(
                { id: "114", street: "Rua A", userId: "1", user: { id: "1", name: "John" } },
                "id",
                undefined,
                false,
                false,
                known,
            );

            expect(result.create).toEqual({ id: "114", street: "Rua A", userId: "1" });
            expect(result.update).toEqual({ id: "114", street: "Rua A", userId: "1" });
        });

        it("should accept null for a relation that is not configured", () => {
            const result = parse({ name: "John", address: null }, "id", undefined, false, false, known);

            expect(result).toEqual({ create: { name: "John" }, update: { name: "John" } });
        });

        it("should drop a key that is unknown even when its value is a scalar", () => {
            const result = parse({ name: "John", nope: 1 }, "id", undefined, false, false, known);

            expect(result.create).not.toHaveProperty("nope");
            expect(result.update).not.toHaveProperty("nope");
        });

        it("should still process a configured relation when it is in knownKeys", () => {
            const result = parse(
                { name: "John", address: { street: "Rua A" } },
                "id",
                relations({ address: rel("mto") }),
                false,
                false,
                new Set([...known, "address"]),
            );

            expect(result.create).toEqual({ name: "John", address: { create: { street: "Rua A" } } });
        });
    });

    describe("fkThere (FK in the related entity)", () => {
        it("should strip fkThere from a to-one payload without pk", () => {
            const result = parse(
                { address: { street: "Rua A", userId: "1" } },
                "id",
                relations({ address: rel("oto", undefined, { fkThere: "userId" }) }),
            );

            expect(result.create).toEqual({ address: { create: { street: "Rua A" } } });
            expect(result.update).toEqual({ address: { create: { street: "Rua A" } } });
        });

        it("should strip fkThere from a to-one payload with pk", () => {
            const result = parse(
                { address: { id: "10", street: "Rua A", userId: "1" } },
                "id",
                relations({ address: rel("oto", "upsert", { fkThere: "userId" }) }),
            );
            const address = { id: "10", street: "Rua A" };

            expect(result.create).toEqual({ address: { connectOrCreate: { where: { id: "10" }, create: address } } });
            expect(result.update).toEqual({
                address: { upsert: { where: { id: "10" }, create: address, update: { street: "Rua A" } } },
            });
        });

        it("should strip fkThere from every item of a to-many payload", () => {
            const result = parse(
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

            parse({ address }, "id", relations({ address: rel("oto", undefined, { fkThere: "userId" }) }));

            expect(address).toEqual({ street: "Rua A", userId: "1" });
        });

        it("should not require allowOmitPk nor touch the primary key", () => {
            const result = parse(
                { id: "1", address: { street: "Rua A", userId: "1" } },
                "id",
                relations({ address: rel("oto", undefined, { fkThere: "userId" }) }),
            );

            expect(result.create).toHaveProperty("id", "1");
            expect(result.update).toHaveProperty("id", "1");
        });
    });

    describe("fkHere (FK in the entity itself)", () => {
        const user = { email: "a@a.com", name: "A" };

        it("should drop the fkHere field from create and update when the relation is in the payload", () => {
            const result = parse({ street: "Rua A", userId: "1", user }, "id", relations({ user: ownerRel("userId") }));

            expect(result.create).toEqual({ street: "Rua A", user: { create: user } });
            expect(result.update).toEqual({ street: "Rua A", user: { create: user } });
        });

        it("should drop fkHere even when the relation comes before it in the payload", () => {
            const result = parse({ user, userId: "1" }, "id", relations({ user: ownerRel("userId") }));

            expect(result.create).not.toHaveProperty("userId");
            expect(result.update).not.toHaveProperty("userId");
        });

        it("should keep the fkHere field when the relation is not in the payload", () => {
            const result = parse(
                { id: "1", street: "Rua A", userId: "1" },
                "id",
                relations({ user: ownerRel("userId") }),
            );

            expect(result.create).toEqual({ id: "1", street: "Rua A", userId: "1" });
            expect(result.update).toEqual({ id: "1", street: "Rua A", userId: "1" });
        });

        it("should keep the fkHere field when the relation is undefined", () => {
            const result = parse(
                { street: "Rua A", userId: "1", user: undefined },
                "id",
                relations({ user: ownerRel("userId") }),
            );

            expect(result.create).toEqual({ street: "Rua A", userId: "1" });
        });

        it("should drop every fkHere field when there are several owner relations", () => {
            const result = parse(
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
                expect(() => parse(payload, "id", config)).toThrow(VSRepoAdapterError);
                expect(() => parse(payload, "id", config)).toThrow(
                    expect.objectContaining({ code: AdapterErrorCode.INVALID_DATA }),
                );
            });

            it("should explain the problem and how to solve it in the error message", () => {
                expect(() => parse(payload, "id", config)).toThrow(
                    /primary key 'id'.*'user'.*allowOmitPk.*setGlobalConfig.*database-generated/s,
                );
            });

            it("should list every owner relation in the error message", () => {
                const both = { ...payload, group: { name: "G" } };
                const bothConfig = relations({ user: ownerRel("userId"), group: ownerRel("groupId") });

                expect(() => parse(both, "id", bothConfig)).toThrow(/'user', 'group'/);
            });

            it("should throw even when omitPkInUpdate is true (the pk is still in create)", () => {
                expect(() => parse(payload, "id", config, true)).toThrow(VSRepoAdapterError);
            });

            it("should throw when the owner relation is null and the pk is present", () => {
                const nullable = relations({ user: ownerRel("userId") });

                expect(() => parse({ id: "114", user: null }, "id", nullable)).toThrow(
                    expect.objectContaining({ code: AdapterErrorCode.INVALID_DATA }),
                );
            });

            it("should not throw when the payload has no pk", () => {
                const { id: _id, ...withoutPk } = payload;

                expect(() => parse(withoutPk, "id", config)).not.toThrow();
            });

            it("should not throw when the pk is undefined", () => {
                expect(() => parse({ ...payload, id: undefined }, "id", config)).not.toThrow();
            });

            it("should not throw when the pk is present but the owner relation is not in the payload", () => {
                const result = parse({ id: "114", street: "Rua A", userId: "1" }, "id", config);

                expect(result.create).toEqual({ id: "114", street: "Rua A", userId: "1" });
            });

            it("should drop the pk and the fkHere field from create and update when allowOmitPk is enabled", () => {
                const result = parse(payload, "id", config, false, true);

                expect(result.create).toEqual({
                    street: "Rua A",
                    user: { connectOrCreate: { where: { id: "1" }, create: { id: "1", ...user } } },
                });
                expect(result.update).toEqual({
                    street: "Rua A",
                    user: { connect: { id: "1" } },
                });
            });

            it("should drop the pk from create (and keep it out of update) with omitPkInUpdate and allowOmitPk", () => {
                const result = parse(payload, "id", config, true, true);

                expect(result.create).not.toHaveProperty("id");
                expect(result.update).not.toHaveProperty("id");
                expect(result.create).not.toHaveProperty("userId");
            });

            it("should only drop the entity pk, not the pk of the related record", () => {
                const result = parse(payload, "id", config, false, true);

                expect(result.create.user.connectOrCreate.where).toEqual({ id: "1" });
                expect(result.create.user.connectOrCreate.create).toHaveProperty("id", "1");
            });

            it("should not mutate the original payload", () => {
                const original = { ...payload };

                parse(original, "id", config, false, true);

                expect(original).toEqual(payload);
            });
        });
    });
});
