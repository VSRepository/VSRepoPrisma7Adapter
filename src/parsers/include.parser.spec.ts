import { AdapterErrorCode, VSRepoRelations, VSRepoRelationsOptions } from "vsrepo";
import { parsePrismaInclude } from "./include.parser.js";

interface User {
    id: string;
    name: string;
    posts: {
        title: string;
        published: boolean;
        createdAt: Date;
        tags: { name: string; category: { name: string } }[];
        comments: { text: string }[];
    }[];
    address: { city: string; state: string } | null;
}

describe("parsePrismaInclude", () => {
    it("should convert a VSRepoRelations to a valid Prisma include", () => {
        const relations: VSRepoRelations<User> = { address: true, posts: { tags: { category: true } } };

        const result = parsePrismaInclude(relations);

        expect(result).toEqual({ address: true, posts: { include: { tags: { include: { category: true } } } } });
    });

    it("should convert a VSRepoRelations to a valid Prisma include too", () => {
        const relations: VSRepoRelations<User> = { address: true, posts: true };

        const result = parsePrismaInclude(relations);

        expect(result).toEqual({ address: true, posts: true });
    });

    describe("relationsOptions", () => {
        it("should turn a relation loaded with `true` into its Prisma args", () => {
            const relations: VSRepoRelations<User> = { address: true, posts: true };
            const relationsOptions: VSRepoRelationsOptions<User> = {
                posts: {
                    where: { published: true },
                    order: { createdAt: "desc" },
                    pagination: { offset: 5, limit: 10 },
                },
            };

            const result = parsePrismaInclude(relations, relationsOptions);

            expect(result).toEqual({
                address: true,
                posts: { where: { published: true }, orderBy: { createdAt: "desc" }, skip: 5, take: 10 },
            });
        });

        it("should keep the args next to the nested include of a relation loaded with an object", () => {
            const relations: VSRepoRelations<User> = { posts: { tags: true } };
            const relationsOptions: VSRepoRelationsOptions<User> = { posts: { pagination: { limit: 3 } } };

            const result = parsePrismaInclude(relations, relationsOptions);

            expect(result).toEqual({ posts: { take: 3, include: { tags: true } } });
        });

        it("should apply the nested relationsOptions to the nested relations", () => {
            const relations: VSRepoRelations<User> = { posts: { comments: true, tags: { category: true } } };
            const relationsOptions: VSRepoRelationsOptions<User> = {
                posts: {
                    where: { published: true },
                    relationsOptions: {
                        comments: { order: { text: "asc" }, pagination: { limit: 5 } },
                        tags: { where: { name: "ts" } },
                    },
                },
            };

            const result = parsePrismaInclude(relations, relationsOptions);

            expect(result).toEqual({
                posts: {
                    where: { published: true },
                    include: {
                        comments: { orderBy: { text: "asc" }, take: 5 },
                        tags: { where: { name: "ts" }, include: { category: true } },
                    },
                },
            });
        });

        it("should accept a where on a to-one relation that can be null", () => {
            const relations: VSRepoRelations<User> = { address: true };
            const relationsOptions: VSRepoRelationsOptions<User> = { address: { where: { city: "Aracaju" } } };

            expect(parsePrismaInclude(relations, relationsOptions)).toEqual({
                address: { where: { city: "Aracaju" } },
            });
        });

        it("should keep `true` when the options of a relation have nothing to configure", () => {
            const relations: VSRepoRelations<User> = { posts: true };
            const relationsOptions: VSRepoRelationsOptions<User> = {
                posts: { relationsOptions: { comments: { pagination: { limit: 1 } } } },
            };

            expect(parsePrismaInclude(relations, relationsOptions)).toEqual({ posts: true });
            expect(parsePrismaInclude(relations, { posts: {} })).toEqual({ posts: true });
        });

        it("should ignore the options of relations that are not being loaded", () => {
            const relations: VSRepoRelations<User> = { address: true, posts: false };
            const relationsOptions: VSRepoRelationsOptions<User> = {
                posts: { pagination: { limit: 3 } },
            };

            const result = parsePrismaInclude(relations, relationsOptions);

            expect(result).toEqual({ address: true, posts: false });
            expect(parsePrismaInclude({ address: true }, relationsOptions)).toEqual({ address: true });
        });

        it("should ignore the nested options of nested relations that are not being loaded", () => {
            const relations: VSRepoRelations<User> = { posts: { tags: true } };
            const relationsOptions: VSRepoRelationsOptions<User> = {
                posts: { relationsOptions: { comments: { pagination: { limit: 3 } } } },
            };

            expect(parsePrismaInclude(relations, relationsOptions)).toEqual({ posts: { include: { tags: true } } });
        });

        it("should return the same as without relationsOptions when they are not provided", () => {
            const relations: VSRepoRelations<User> = { address: true, posts: { tags: { category: true } } };

            expect(parsePrismaInclude(relations, undefined)).toEqual(parsePrismaInclude(relations));
            expect(parsePrismaInclude(relations, {})).toEqual(parsePrismaInclude(relations));
        });

        it("should translate the where for the provider", () => {
            const relations: VSRepoRelations<User> = { posts: true };
            const relationsOptions: VSRepoRelationsOptions<User> = {
                posts: { where: { title: { contains: "a", ignoreCase: true } } },
            };

            expect(parsePrismaInclude(relations, relationsOptions, "postgresql")).toEqual({
                posts: { where: { title: { contains: "a", mode: "insensitive" } } },
            });
            expect(() => parsePrismaInclude(relations, relationsOptions, "sqlite")).toThrow(
                expect.objectContaining({ code: AdapterErrorCode.NOT_SUPPORTED }),
            );
        });
    });
});
