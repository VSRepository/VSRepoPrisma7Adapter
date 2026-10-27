import { Relation } from "../types/relation.type.js";
import { mergeEntities } from "./merge-entities.resolver.js";

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

function merge(result: any, obj: any, relations?: any): any {
    return mergeEntities(result, obj, relations);
}

function relations(config: Record<string, Relation<any>>): any {
    return config;
}

function rel(mode: Relation["mode"], extra: Partial<Relation> = {}): Relation<any> {
    return { mode, restriction: "add", pk: "id", ...extra };
}

describe("mergeEntities", () => {
    describe("without relations", () => {
        it("should override scalar fields with the values from obj", () => {
            const result = merge({ id: "1", name: "John", age: 30 }, { name: "Jane", age: 31 });

            expect(result).toEqual({ id: "1", name: "Jane", age: 31 });
        });

        it("should keep fields that only exist in result and add fields that only exist in obj", () => {
            const result = merge({ id: "1", name: "John" }, { email: "john@mail.com" });

            expect(result).toEqual({ id: "1", name: "John", email: "john@mail.com" });
        });

        it("should return a copy of result when obj is empty", () => {
            const original = { id: "1", name: "John" };

            const result = merge(original, {});

            expect(result).toEqual(original);
            expect(result).not.toBe(original);
        });

        it("should ignore top-level undefined fields in obj", () => {
            const result = merge({ id: "1", name: "John" }, { name: undefined });

            expect(result).toEqual({ id: "1", name: "John" });
        });

        it("should override with null", () => {
            const result = merge({ id: "1", name: "John" }, { name: null });

            expect(result).toEqual({ id: "1", name: null });
        });

        it("should replace nested objects instead of merging them", () => {
            const result = merge(
                { address: { city: "Aracaju", state: "SE" } },
                { address: { city: "Estância", zip: "49200" } },
            );

            expect(result).toEqual({ address: { city: "Estância", zip: "49200" } });
        });

        it("should replace a nested object with null", () => {
            const result = merge({ address: { city: "Aracaju" } }, { address: null });

            expect(result).toEqual({ address: null });
        });

        it("should replace arrays instead of concatenating them", () => {
            const result = merge({ tags: ["a", "b"] }, { tags: ["c"] });

            expect(result).toEqual({ tags: ["c"] });
        });

        it("should replace arrays of objects instead of merging them", () => {
            const result = merge({ posts: [{ id: "1", title: "A" }] }, { posts: [{ id: "1" }, { id: "2" }] });

            expect(result).toEqual({ posts: [{ id: "1" }, { id: "2" }] });
        });

        it("should replace with an empty array", () => {
            const result = merge({ tags: ["a"] }, { tags: [] });

            expect(result).toEqual({ tags: [] });
        });

        it("should replace Date values by reference", () => {
            const newDate = new Date("2026-02-02T00:00:00.000Z");

            const result = merge({ createdAt: new Date("2026-01-01T00:00:00.000Z") }, { createdAt: newDate });

            expect(result.createdAt).toBe(newDate);
        });

        it("should keep Decimal values from result as the same Decimal instance", () => {
            const price = new Decimal(10);

            const result = merge({ name: "John", price }, { name: "Jane" });

            expect(result.price).toBe(price);
            expect(result.price).toBeInstanceOf(Decimal);
        });

        it("should keep Decimal values from obj as the same Decimal instance", () => {
            const price = new Decimal(20);

            const result = merge({ price: new Decimal(10) }, { price });

            expect(result.price).toBe(price);
            expect(result.price).toBeInstanceOf(Decimal);
        });

        it("should not mutate result or obj", () => {
            const original = { id: "1", address: { city: "Aracaju" }, tags: ["a"] };
            const source = { id: "2", address: { state: "SE" }, tags: ["b"] };

            const result = merge(original, source);

            expect(original).toEqual({ id: "1", address: { city: "Aracaju" }, tags: ["a"] });
            expect(source).toEqual({ id: "2", address: { state: "SE" }, tags: ["b"] });
            expect(result).not.toBe(original);
        });
    });

    describe("with relations", () => {
        describe("non-relation fields", () => {
            const config = relations({ address: rel("mto"), posts: rel("otm") });

            it("should override scalar fields and keep fields that only exist in result", () => {
                const result = merge({ id: "1", name: "John", age: 30 }, { name: "Jane" }, config);

                expect(result).toEqual({ id: "1", name: "Jane", age: 30 });
            });

            it("should add fields that only exist in obj", () => {
                const result = merge({ id: "1" }, { name: "John" }, config);

                expect(result).toEqual({ id: "1", name: "John" });
            });

            it("should ignore undefined fields in obj", () => {
                const result = merge({ id: "1", name: "John" }, { name: undefined, posts: undefined }, config);

                expect(result).toEqual({ id: "1", name: "John" });
            });

            it("should override with null", () => {
                const result = merge({ id: "1", name: "John" }, { name: null }, config);

                expect(result).toEqual({ id: "1", name: null });
            });

            it("should replace non-relation objects and arrays instead of merging them", () => {
                const result = merge(
                    { id: "1", meta: { a: 1, b: 2 }, tags: ["a", "b"] },
                    { meta: { b: 3 }, tags: ["c"] },
                    config,
                );

                expect(result).toEqual({ id: "1", meta: { b: 3 }, tags: ["c"] });
            });

            it("should not mutate result or obj", () => {
                const original = {
                    id: "1",
                    posts: [{ id: "1", title: "A" }],
                    address: { id: "1", street: "x" },
                };
                const source = { posts: [{ id: "1", title: "B" }], address: { street: "y" } };

                const result = merge(original, source, config);

                expect(original).toEqual({
                    id: "1",
                    posts: [{ id: "1", title: "A" }],
                    address: { id: "1", street: "x" },
                });
                expect(source).toEqual({ posts: [{ id: "1", title: "B" }], address: { street: "y" } });
                expect(result).not.toBe(original);
            });
        });

        describe.each(["oto", "mto"] as const)("to-one (%s)", mode => {
            const config = relations({ address: rel(mode) });

            it("should merge the fields when the existing value is an object", () => {
                const result = merge(
                    { id: "1", address: { id: "10", street: "Rua A", city: "Aracaju" } },
                    { address: { street: "Rua B" } },
                    config,
                );

                expect(result).toEqual({ id: "1", address: { id: "10", street: "Rua B", city: "Aracaju" } });
            });

            it("should set the relation to null when obj sends null", () => {
                const result = merge({ id: "1", address: { id: "10", street: "Rua A" } }, { address: null }, config);

                expect(result).toEqual({ id: "1", address: null });
            });

            it("should replace the value when the existing relation is null", () => {
                const result = merge({ id: "1", address: null }, { address: { id: "10", street: "Rua A" } }, config);

                expect(result).toEqual({ id: "1", address: { id: "10", street: "Rua A" } });
            });

            it("should set the relation when result does not have it", () => {
                const result = merge({ id: "1" }, { address: { id: "10" } }, config);

                expect(result).toEqual({ id: "1", address: { id: "10" } });
            });

            it("should keep the existing relation when obj does not send it", () => {
                const result = merge({ id: "1", address: { id: "10" } }, { address: undefined }, config);

                expect(result).toEqual({ id: "1", address: { id: "10" } });
            });

            it("should not let undefined fields erase existing values of the related object", () => {
                const result = merge(
                    { address: { id: "10", street: "Rua A", city: "Aracaju" } },
                    { address: { street: undefined, city: "Estância" } },
                    config,
                );

                expect(result.address).toEqual({ id: "10", street: "Rua A", city: "Estância" });
            });

            it("should replace nested objects and arrays of the related object instead of merging them", () => {
                const result = merge(
                    { address: { id: "10", geo: { lat: 1, lng: 2 }, tags: ["a"] } },
                    { address: { geo: { lat: 5 }, tags: ["b"] } },
                    config,
                );

                expect(result.address).toEqual({ id: "10", geo: { lat: 5 }, tags: ["b"] });
            });

            it("should keep Decimal values as the same Decimal instance", () => {
                const fromResultPrice = new Decimal(1);
                const fromObjPrice = new Decimal(2);

                const fromResult = merge(
                    { address: { id: "10", price: fromResultPrice } },
                    { address: { street: "Rua B" } },
                    config,
                );
                const fromObj = merge({ address: { id: "10" } }, { address: { price: fromObjPrice } }, config);

                expect(fromResult.address.price).toBe(fromResultPrice);
                expect(fromObj.address.price).toBe(fromObjPrice);
            });

            it("should keep Date values by reference", () => {
                const date = new Date("2026-01-01T00:00:00.000Z");

                const result = merge({ address: { id: "10" } }, { address: { createdAt: date } }, config);

                expect(result.address.createdAt).toBe(date);
            });
        });

        describe.each(["otm", "mtm"] as const)("to-many (%s)", mode => {
            const config = relations({ posts: rel(mode) });

            it("should merge items that share the same pk", () => {
                const result = merge(
                    { posts: [{ id: "1", title: "A", body: "x" }] },
                    { posts: [{ id: "1", title: "B" }] },
                    config,
                );

                expect(result.posts).toEqual([{ id: "1", title: "B", body: "x" }]);
            });

            it("should keep items from result that were not sent", () => {
                const result = merge(
                    {
                        posts: [
                            { id: "1", title: "A" },
                            { id: "2", title: "B" },
                        ],
                    },
                    { posts: [{ id: "1", title: "A2" }] },
                    config,
                );

                expect(result.posts).toEqual([
                    { id: "1", title: "A2" },
                    { id: "2", title: "B" },
                ]);
            });

            it("should append items with a new pk", () => {
                const result = merge(
                    { posts: [{ id: "1", title: "A" }] },
                    { posts: [{ id: "2", title: "B" }] },
                    config,
                );

                expect(result.posts).toEqual([
                    { id: "1", title: "A" },
                    { id: "2", title: "B" },
                ]);
            });

            it("should keep items without pk from both sides, after the items with pk", () => {
                const result = merge(
                    { posts: [{ title: "n1" }, { id: "2" }, { id: "1" }] },
                    { posts: [{ title: "n2" }, { id: "3" }, { id: "1", extra: true }] },
                    config,
                );

                expect(result.posts).toEqual([
                    { id: "2" },
                    { id: "1", extra: true },
                    { id: "3" },
                    { title: "n1" },
                    { title: "n2" },
                ]);
            });

            it("should merge repeated pks sent in obj into a single item", () => {
                const result = merge(
                    { posts: [] },
                    {
                        posts: [
                            { id: "1", a: 1 },
                            { id: "1", b: 2 },
                        ],
                    },
                    config,
                );

                expect(result.posts).toEqual([{ id: "1", a: 1, b: 2 }]);
            });

            it("should treat a null pk as present (only undefined means absent)", () => {
                const result = merge({ posts: [{ id: null, a: 1 }] }, { posts: [{ id: null, b: 2 }] }, config);

                expect(result.posts).toEqual([{ id: null, a: 1, b: 2 }]);
            });

            it("should replace nested arrays and objects of merged items instead of merging them", () => {
                const result = merge(
                    { posts: [{ id: "1", tags: ["a"], meta: { x: 1, y: 2 } }] },
                    { posts: [{ id: "1", tags: ["b"], meta: { x: 9 } }] },
                    config,
                );

                expect(result.posts).toEqual([{ id: "1", tags: ["b"], meta: { x: 9 } }]);
            });

            it("should not let undefined fields erase existing values of merged items", () => {
                const result = merge(
                    { posts: [{ id: "1", title: "A", body: "x" }] },
                    { posts: [{ id: "1", title: undefined, body: "y" }] },
                    config,
                );

                expect(result.posts).toEqual([{ id: "1", title: "A", body: "y" }]);
            });

            it("should replace the value when the existing relation is not an array", () => {
                const fromUndefined = merge({ id: "1" }, { posts: [{ id: "1" }] }, config);
                const fromNull = merge({ id: "1", posts: null }, { posts: [{ id: "1" }] }, config);

                expect(fromUndefined.posts).toEqual([{ id: "1" }]);
                expect(fromNull.posts).toEqual([{ id: "1" }]);
            });

            it("should keep the existing items when obj does not send the relation", () => {
                const result = merge({ posts: [{ id: "1" }] }, { posts: undefined }, config);

                expect(result.posts).toEqual([{ id: "1" }]);
            });

            it("should return the existing items unchanged when obj sends an empty array", () => {
                const result = merge({ posts: [{ id: "1" }, { title: "n" }] }, { posts: [] }, config);

                expect(result.posts).toEqual([{ id: "1" }, { title: "n" }]);
            });

            it("should use relation.pk instead of 'id'", () => {
                const custom = relations({ tags: rel(mode, { pk: "code" }) });

                const result = merge(
                    { tags: [{ code: "x", name: "X" }] },
                    {
                        tags: [
                            { code: "x", name: "X2" },
                            { code: "y", name: "Y" },
                        ],
                    },
                    custom,
                );

                expect(result.tags).toEqual([
                    { code: "x", name: "X2" },
                    { code: "y", name: "Y" },
                ]);
            });

            it("should keep Decimal values inside merged items as the same Decimal instance", () => {
                const price = new Decimal(1);

                const result = merge({ posts: [{ id: "1", price }] }, { posts: [{ id: "1", title: "B" }] }, config);

                expect(result.posts[0].price).toBe(price);
            });
        });

        it("should handle fields and several relations in the same merge", () => {
            const config = relations({ address: rel("mto"), posts: rel("otm"), tags: rel("mtm", { pk: "code" }) });

            const result = merge(
                {
                    id: "1",
                    name: "John",
                    address: { id: "10", street: "Rua A" },
                    posts: [{ id: "1", title: "A" }],
                    tags: [{ code: "x", name: "X" }],
                },
                {
                    name: "Jane",
                    address: { street: "Rua B" },
                    posts: [{ id: "2", title: "B" }],
                    tags: [{ code: "x", name: "X2" }],
                },
                config,
            );

            expect(result).toEqual({
                id: "1",
                name: "Jane",
                address: { id: "10", street: "Rua B" },
                posts: [
                    { id: "1", title: "A" },
                    { id: "2", title: "B" },
                ],
                tags: [{ code: "x", name: "X2" }],
            });
        });
    });
});
