import { AdapterErrorCode } from "vsrepo";
import { parsePrismaRelationArgs } from "./relation-options.parser.js";

describe("parsePrismaRelationArgs", () => {
    it("should return no args when there are no options", () => {
        expect(parsePrismaRelationArgs(undefined)).toEqual({});
        expect(parsePrismaRelationArgs({})).toEqual({});
    });

    it("should only return the keys that were provided", () => {
        const args = parsePrismaRelationArgs({ where: undefined, order: undefined, pagination: {} });

        expect(Object.keys(args)).toEqual([]);
    });

    it("should convert where", () => {
        const args = parsePrismaRelationArgs({ where: { published: true, title: { between: ["a", "m"] } } });

        expect(args).toEqual({ where: { published: true, title: { gte: "a", lte: "m" } } });
    });

    it("should convert where operators of relations", () => {
        const args = parsePrismaRelationArgs({ where: { tags: { _some: { name: "ts" } } } });

        expect(args).toEqual({ where: { tags: { some: { name: "ts" } } } });
    });

    it("should convert order, lowercasing the directions", () => {
        expect(parsePrismaRelationArgs({ order: { createdAt: "DESC" } })).toEqual({ orderBy: { createdAt: "desc" } });
        expect(parsePrismaRelationArgs({ order: [{ title: "asc" }, { id: "DESC" }] })).toEqual({
            orderBy: [{ title: "asc" }, { id: "desc" }],
        });
    });

    it("should convert pagination into skip and take", () => {
        expect(parsePrismaRelationArgs({ pagination: { offset: 5, limit: 10 } })).toEqual({ skip: 5, take: 10 });
        expect(parsePrismaRelationArgs({ pagination: { limit: 10 } })).toEqual({ take: 10 });
        expect(parsePrismaRelationArgs({ pagination: { offset: 5 } })).toEqual({ skip: 5 });
    });

    it("should keep a limit and an offset of 0", () => {
        expect(parsePrismaRelationArgs({ pagination: { offset: 0, limit: 0 } })).toEqual({ skip: 0, take: 0 });
    });

    it("should ignore the nested relationsOptions, which are handled by the include/select parsers", () => {
        const args = parsePrismaRelationArgs({ relationsOptions: { comments: { pagination: { limit: 1 } } } });

        expect(args).toEqual({});
    });

    it("should combine everything", () => {
        const args = parsePrismaRelationArgs({
            where: { published: true },
            order: { createdAt: "desc" },
            pagination: { offset: 2, limit: 3 },
        });

        expect(args).toEqual({
            where: { published: true },
            orderBy: { createdAt: "desc" },
            skip: 2,
            take: 3,
        });
    });

    describe("provider", () => {
        const options = { where: { title: { contains: "a", ignoreCase: true } } };

        it.each(["postgresql", "cockroachdb"] as const)("should translate ignoreCase on %s", provider => {
            expect(parsePrismaRelationArgs(options, provider)).toEqual({
                where: { title: { contains: "a", mode: "insensitive" } },
            });
        });

        it.each(["mysql", "sqlite", "sqlserver"] as const)(
            "should reject ignoreCase on %s with NOT_SUPPORTED",
            provider => {
                expect(() => parsePrismaRelationArgs(options, provider)).toThrow(
                    expect.objectContaining({ code: AdapterErrorCode.NOT_SUPPORTED }),
                );
            },
        );
    });
});
