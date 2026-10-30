import { AdapterErrorCode, DecimalLike, VSRepoAdapterError, VSRepoWhere } from "vsrepo";
import { PrismaProvider } from "../types/prisma-provider.type.js";
import { parsePrismaWhere } from "./where.parser.js";

interface User {
    id: string;
    name: string;
    age: number;
    active: boolean;
    balance: DecimalLike;
    createdAt: Date;
    deletedAt: Date | null;
    address: { city: string; state: string };
    posts: { title: string; published: boolean }[];
}

function fakeDecimal(value: number): DecimalLike {
    return {
        toNumber: () => value,
        decimalPlaces: () => value,
        toFixed: () => String(value),
        toString: () => String(value),
    } as DecimalLike;
}

describe("parsePrismaWhere", () => {
    describe("basic behavior", () => {
        it("should return undefined when where is undefined", () => {
            expect(parsePrismaWhere(undefined)).toBeUndefined();
        });

        it("should return an empty object when where is empty", () => {
            expect(parsePrismaWhere<User>({})).toEqual({});
        });

        it("should keep direct values (shorthand for equals) untouched", () => {
            const where: VSRepoWhere<User> = { id: "1", name: "John", active: true, age: 30 };

            expect(parsePrismaWhere(where)).toEqual({ id: "1", name: "John", active: true, age: 30 });
        });

        it("should keep null values untouched", () => {
            const where: VSRepoWhere<User> = { deletedAt: null };

            expect(parsePrismaWhere(where)).toEqual({ deletedAt: null });
        });

        it("should skip undefined fields", () => {
            const where: VSRepoWhere<User> = { id: "1", name: undefined, age: { gt: undefined } };

            expect(parsePrismaWhere(where)).toEqual({ id: "1", age: {} });
        });

        it("should keep Date values untouched", () => {
            const date = new Date("2026-01-01T00:00:00.000Z");

            const result = parsePrismaWhere<User>({ createdAt: date });

            expect(result).toEqual({ createdAt: date });
            expect(result?.createdAt).toBe(date);
        });

        it("should keep Decimal-like values untouched", () => {
            const decimal = fakeDecimal(10.5);

            const result = parsePrismaWhere<User>({ balance: decimal });

            expect(result?.balance).toBe(decimal);
        });

        it("should keep Date and Decimal-like values untouched inside operators", () => {
            const date = new Date("2026-01-01T00:00:00.000Z");
            const decimal = fakeDecimal(10.5);

            const result = parsePrismaWhere<User>({
                createdAt: { gt: date },
                balance: { lte: decimal },
            });

            expect(result?.createdAt).toEqual({ gt: date });
            expect(result?.createdAt.gt).toBe(date);
            expect(result?.balance.lte).toBe(decimal);
        });
    });

    describe("field operators", () => {
        it("should pass comparison operators through", () => {
            const where: VSRepoWhere<User> = {
                age: { gt: 18, lt: 60 },
                name: { equals: "John", in: ["John", "Jane"], notIn: ["Bob"] },
            };

            expect(parsePrismaWhere(where)).toEqual({
                age: { gt: 18, lt: 60 },
                name: { equals: "John", in: ["John", "Jane"], notIn: ["Bob"] },
            });
        });

        it("should pass string operators through", () => {
            const where: VSRepoWhere<User> = { name: { contains: "oh", startsWith: "J", endsWith: "n" } };

            expect(parsePrismaWhere(where)).toEqual({ name: { contains: "oh", startsWith: "J", endsWith: "n" } });
        });
    });

    describe("ignoreCase", () => {
        it("should convert ignoreCase: true to mode: 'insensitive'", () => {
            const where: VSRepoWhere<User> = { name: { contains: "john", ignoreCase: true } };

            expect(parsePrismaWhere(where)).toEqual({ name: { contains: "john", mode: "insensitive" } });
        });

        it("should omit mode when ignoreCase is false", () => {
            const where: VSRepoWhere<User> = { name: { contains: "john", ignoreCase: false } };

            expect(parsePrismaWhere(where)).toEqual({ name: { contains: "john" } });
        });

        it("should not leak the ignoreCase key into the result", () => {
            const where: VSRepoWhere<User> = { name: { startsWith: "j", ignoreCase: true } };

            expect(parsePrismaWhere(where)?.name).not.toHaveProperty("ignoreCase");
        });

        describe("provider support", () => {
            const insensitive = { name: { contains: "john", ignoreCase: true } } as VSRepoWhere<User>;
            const unsupportedProviders = ["mysql", "sqlite", "sqlserver"] as const;

            it.each(["postgresql", "cockroachdb"] as const)("should convert ignoreCase to mode for %s", provider => {
                expect(parsePrismaWhere(insensitive, provider)).toEqual({
                    name: { contains: "john", mode: "insensitive" },
                });
            });

            it.each(unsupportedProviders)("should throw NOT_SUPPORTED for %s when ignoreCase is true", provider => {
                const parse = () => parsePrismaWhere(insensitive, provider);

                expect(parse).toThrow(VSRepoAdapterError);
                expect(parse).toThrow(expect.objectContaining({ code: AdapterErrorCode.NOT_SUPPORTED }));
                expect(parse).toThrow(new RegExp(`'ignoreCase'.*'${provider}'`));
            });

            it.each(unsupportedProviders)("should accept ignoreCase: false/undefined for %s", provider => {
                const where = [
                    { name: { contains: "john", ignoreCase: false } },
                    { name: { contains: "john", ignoreCase: undefined } },
                ] as VSRepoWhere<User>[];

                expect(parsePrismaWhere(where[0], provider)).toEqual({ name: { contains: "john" } });
                expect(parsePrismaWhere(where[1], provider)).toEqual({ name: { contains: "john" } });
            });

            it.each([
                ["not", { name: { not: { contains: "j", ignoreCase: true } } }],
                ["OR", { OR: [{ name: "a" }, { name: { contains: "j", ignoreCase: true } }] }],
                ["AND", { AND: [{ name: { contains: "j", ignoreCase: true } }] }],
                ["NOT", { NOT: { name: { contains: "j", ignoreCase: true } } }],
                ["_some", { address: { _some: { city: { contains: "j", ignoreCase: true } } } }],
                ["_every", { address: { _every: { city: { contains: "j", ignoreCase: true } } } }],
                ["_none", { address: { _none: { city: { contains: "j", ignoreCase: true } } } }],
                ["_with", { address: { _with: { city: { contains: "j", ignoreCase: true } } } }],
                ["_without", { address: { _without: { city: { contains: "j", ignoreCase: true } } } }],
            ] as const)("should also reject ignoreCase nested inside %s", (_label, where) => {
                const parse = () => parsePrismaWhere(where as unknown as VSRepoWhere<User>, "mysql");

                expect(parse).toThrow(expect.objectContaining({ code: AdapterErrorCode.NOT_SUPPORTED }));
            });

            it("should not validate the provider when none is given", () => {
                const provider: PrismaProvider | undefined = undefined;

                expect(parsePrismaWhere(insensitive, provider)).toEqual({
                    name: { contains: "john", mode: "insensitive" },
                });
            });
        });
    });

    describe("between", () => {
        it("should convert between to gte/lte", () => {
            const where: VSRepoWhere<User> = { age: { between: [18, 60] } };

            expect(parsePrismaWhere(where)).toEqual({ age: { gte: 18, lte: 60 } });
        });

        it("should convert between with Dates", () => {
            const min = new Date("2026-01-01T00:00:00.000Z");
            const max = new Date("2026-12-31T23:59:59.999Z");

            const result = parsePrismaWhere<User>({ createdAt: { between: [min, max] } });

            expect(result).toEqual({ createdAt: { gte: min, lte: max } });
        });

        it("should skip an undefined bound", () => {
            const where = { age: { between: [undefined, 60] } } as unknown as VSRepoWhere<User>;

            expect(parsePrismaWhere(where)).toEqual({ age: { lte: 60 } });
        });

        it("should not leak the between key into the result", () => {
            const where: VSRepoWhere<User> = { age: { between: [1, 2] } };

            expect(parsePrismaWhere(where)?.age).not.toHaveProperty("between");
        });

        it("should combine between with other operators", () => {
            const where: VSRepoWhere<User> = { age: { between: [18, 60], not: 30 } };

            expect(parsePrismaWhere(where)).toEqual({ age: { gte: 18, lte: 60, not: 30 } });
        });
    });

    describe("not", () => {
        it("should keep a primitive not value", () => {
            const where: VSRepoWhere<User> = { name: { not: "John" } };

            expect(parsePrismaWhere(where)).toEqual({ name: { not: "John" } });
        });

        it("should keep a null not value", () => {
            const where: VSRepoWhere<User> = { deletedAt: { not: null } };

            expect(parsePrismaWhere(where)).toEqual({ deletedAt: { not: null } });
        });

        it("should keep a Date not value untouched", () => {
            const date = new Date("2026-01-01T00:00:00.000Z");

            const result = parsePrismaWhere<User>({ createdAt: { not: date } });

            expect(result?.createdAt.not).toBe(date);
        });

        it("should parse a nested operator object inside not", () => {
            const where: VSRepoWhere<User> = { name: { not: { contains: "john", ignoreCase: true } } };

            expect(parsePrismaWhere(where)).toEqual({
                name: { not: { contains: "john", mode: "insensitive" } },
            });
        });

        it("should parse between inside not", () => {
            const where: VSRepoWhere<User> = { age: { not: { between: [18, 60] } } };

            expect(parsePrismaWhere(where)).toEqual({ age: { not: { gte: 18, lte: 60 } } });
        });
    });

    describe("to-many relations", () => {
        it("should convert _some to some", () => {
            const where: VSRepoWhere<User> = { posts: { _some: { published: true } } };

            expect(parsePrismaWhere(where)).toEqual({ posts: { some: { published: true } } });
        });

        it("should convert _every to every", () => {
            const where: VSRepoWhere<User> = { posts: { _every: { published: true } } };

            expect(parsePrismaWhere(where)).toEqual({ posts: { every: { published: true } } });
        });

        it("should convert _none to none", () => {
            const where: VSRepoWhere<User> = { posts: { _none: { published: false } } };

            expect(parsePrismaWhere(where)).toEqual({ posts: { none: { published: false } } });
        });

        it("should parse operators inside relation filters", () => {
            const where: VSRepoWhere<User> = {
                posts: { _some: { title: { contains: "nest", ignoreCase: true } } },
            };

            expect(parsePrismaWhere(where)).toEqual({
                posts: { some: { title: { contains: "nest", mode: "insensitive" } } },
            });
        });

        it("should convert multiple relation operators in the same filter", () => {
            const where: VSRepoWhere<User> = {
                posts: { _some: { published: true }, _none: { title: "draft" } },
            };

            expect(parsePrismaWhere(where)).toEqual({
                posts: { some: { published: true }, none: { title: "draft" } },
            });
        });
    });

    describe("to-one relations", () => {
        it("should convert _with to is", () => {
            const where: VSRepoWhere<User> = { address: { _with: { city: "Aracaju" } } };

            expect(parsePrismaWhere(where)).toEqual({ address: { is: { city: "Aracaju" } } });
        });

        it("should convert _without to isNot", () => {
            const where: VSRepoWhere<User> = { address: { _without: { state: "SP" } } };

            expect(parsePrismaWhere(where)).toEqual({ address: { isNot: { state: "SP" } } });
        });

        it("should parse operators inside _with/_without", () => {
            const where: VSRepoWhere<User> = {
                address: {
                    _with: { city: { startsWith: "ara", ignoreCase: true } },
                    _without: { state: { in: ["SP", "RJ"] } },
                },
            };

            expect(parsePrismaWhere(where)).toEqual({
                address: {
                    is: { city: { startsWith: "ara", mode: "insensitive" } },
                    isNot: { state: { in: ["SP", "RJ"] } },
                },
            });
        });
    });

    describe("logical operators", () => {
        it("should parse AND with an array", () => {
            const where: VSRepoWhere<User> = {
                AND: [{ name: { contains: "j", ignoreCase: true } }, { age: { between: [18, 60] } }],
            };

            expect(parsePrismaWhere(where)).toEqual({
                AND: [{ name: { contains: "j", mode: "insensitive" } }, { age: { gte: 18, lte: 60 } }],
            });
        });

        it("should parse OR with an array", () => {
            const where: VSRepoWhere<User> = { OR: [{ name: "John" }, { name: "Jane" }] };

            expect(parsePrismaWhere(where)).toEqual({ OR: [{ name: "John" }, { name: "Jane" }] });
        });

        it("should parse NOT with a single object", () => {
            const where: VSRepoWhere<User> = { NOT: { name: { contains: "john", ignoreCase: true } } };

            expect(parsePrismaWhere(where)).toEqual({ NOT: { name: { contains: "john", mode: "insensitive" } } });
        });

        it("should parse NOT with an array", () => {
            const where: VSRepoWhere<User> = { NOT: [{ name: "John" }, { age: { lt: 18 } }] };

            expect(parsePrismaWhere(where)).toEqual({ NOT: [{ name: "John" }, { age: { lt: 18 } }] });
        });

        it("should parse nested logical operators", () => {
            const where: VSRepoWhere<User> = {
                active: true,
                OR: [
                    { name: "John" },
                    { AND: [{ age: { between: [18, 30] } }, { NOT: { address: { _with: { state: "SP" } } } }] },
                ],
            };

            expect(parsePrismaWhere(where)).toEqual({
                active: true,
                OR: [
                    { name: "John" },
                    { AND: [{ age: { gte: 18, lte: 30 } }, { NOT: { address: { is: { state: "SP" } } } }] },
                ],
            });
        });

        it("should skip undefined logical operators", () => {
            const where: VSRepoWhere<User> = { id: "1", AND: undefined, OR: undefined };

            expect(parsePrismaWhere(where)).toEqual({ id: "1" });
        });

        it("should not treat logical keys as field values", () => {
            const where: VSRepoWhere<User> = { OR: [{ name: { not: "John" } }] };

            expect(parsePrismaWhere(where)).toEqual({ OR: [{ name: { not: "John" } }] });
        });
    });

    describe("unsupported operators", () => {
        it("should throw a VSRepoAdapterError with NOT_SUPPORTED for 'like'", () => {
            const where: VSRepoWhere<User> = { name: { like: "jo%" } };

            expect(() => parsePrismaWhere(where)).toThrow(VSRepoAdapterError);

            try {
                parsePrismaWhere(where);
            } catch (error: any) {
                expect(error.code).toBe(AdapterErrorCode.NOT_SUPPORTED);
            }
        });

        it("should mention the alternatives in the 'like' error message", () => {
            const where: VSRepoWhere<User> = { name: { like: "jo%" } };

            expect(() => parsePrismaWhere(where)).toThrow(/'like'.*contains.*startsWith.*endsWith/s);
        });

        it("should throw for 'like' combined with ignoreCase", () => {
            const where: VSRepoWhere<User> = { name: { like: "jo%", ignoreCase: true } };

            expect(() => parsePrismaWhere(where)).toThrow(VSRepoAdapterError);
        });

        it("should throw for 'like' nested inside not", () => {
            const where: VSRepoWhere<User> = { name: { not: { like: "jo%" } } };

            expect(() => parsePrismaWhere(where)).toThrow(VSRepoAdapterError);
        });

        it("should throw for 'like' nested inside logical operators", () => {
            const where: VSRepoWhere<User> = { OR: [{ name: "John" }, { AND: [{ name: { like: "jo%" } }] }] };

            expect(() => parsePrismaWhere(where)).toThrow(VSRepoAdapterError);
        });

        it("should throw for 'like' nested inside relation filters", () => {
            const where: VSRepoWhere<User> = { posts: { _some: { title: { like: "%nest%" } } } };

            expect(() => parsePrismaWhere(where)).toThrow(VSRepoAdapterError);
        });

        it("should not throw when 'like' is undefined", () => {
            const where: VSRepoWhere<User> = { name: { like: undefined, contains: "jo" } };

            expect(parsePrismaWhere(where)).toEqual({ name: { contains: "jo" } });
        });
    });
});
