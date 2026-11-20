import { AdapterErrorCode, VSRepoRelationsOptions, VSRepoSelect } from "vsrepo";
import { parsePrismaSelect } from "./select.parser.js";

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

describe("parsePrismaSelect", () => {
    it("should convert a VSRepoSelect to a valid Prisma select", () => {
        const relations: VSRepoSelect<User> = {
            address: true,
            id: true,
            posts: { tags: { category: true }, title: true },
        };

        const result = parsePrismaSelect(relations);

        expect(result).toEqual({
            address: true,
            id: true,
            posts: { select: { tags: { select: { category: true } }, title: true } },
        });
    });

    it("should convert a VSRepoSelect to a valid Prisma select too", () => {
        const relations: VSRepoSelect<User> = { address: { city: true }, posts: true };

        const result = parsePrismaSelect(relations);

        expect(result).toEqual({ address: { select: { city: true } }, posts: true });
    });

    describe("relationsOptions", () => {
        it("should turn a relation selected with `true` into its Prisma args", () => {
            const select: VSRepoSelect<User> = { id: true, address: true, posts: true };
            const relationsOptions: VSRepoRelationsOptions<User> = {
                posts: {
                    where: { published: true },
                    order: { createdAt: "desc" },
                    pagination: { offset: 5, limit: 10 },
                },
            };

            const result = parsePrismaSelect(select, relationsOptions);

            expect(result).toEqual({
                id: true,
                address: true,
                posts: { where: { published: true }, orderBy: { createdAt: "desc" }, skip: 5, take: 10 },
            });
        });

        it("should keep the args next to the nested select of a relation selected with an object", () => {
            const select: VSRepoSelect<User> = { posts: { title: true } };
            const relationsOptions: VSRepoRelationsOptions<User> = { posts: { pagination: { limit: 3 } } };

            const result = parsePrismaSelect(select, relationsOptions);

            expect(result).toEqual({ posts: { take: 3, select: { title: true } } });
        });

        it("should apply the nested relationsOptions to the nested relations", () => {
            const select: VSRepoSelect<User> = { posts: { title: true, comments: { text: true }, tags: true } };
            const relationsOptions: VSRepoRelationsOptions<User> = {
                posts: {
                    where: { published: true },
                    relationsOptions: {
                        comments: { order: { text: "asc" }, pagination: { limit: 5 } },
                        tags: { where: { name: "ts" } },
                    },
                },
            };

            const result = parsePrismaSelect(select, relationsOptions);

            expect(result).toEqual({
                posts: {
                    where: { published: true },
                    select: {
                        title: true,
                        comments: { orderBy: { text: "asc" }, take: 5, select: { text: true } },
                        tags: { where: { name: "ts" } },
                    },
                },
            });
        });

        it("should accept a where on a to-one relation that can be null", () => {
            const select: VSRepoSelect<User> = { address: { city: true } };
            const relationsOptions: VSRepoRelationsOptions<User> = { address: { where: { city: "Aracaju" } } };

            expect(parsePrismaSelect(select, relationsOptions)).toEqual({
                address: { where: { city: "Aracaju" }, select: { city: true } },
            });
        });

        it("should keep `true` when the options of a relation have nothing to configure", () => {
            const select: VSRepoSelect<User> = { posts: true };
            const relationsOptions: VSRepoRelationsOptions<User> = {
                posts: { relationsOptions: { comments: { pagination: { limit: 1 } } } },
            };

            expect(parsePrismaSelect(select, relationsOptions)).toEqual({ posts: true });
        });

        it("should ignore the options of relations that are not being selected", () => {
            const select: VSRepoSelect<User> = { id: true, address: true, posts: false };
            const relationsOptions: VSRepoRelationsOptions<User> = { posts: { pagination: { limit: 3 } } };

            expect(parsePrismaSelect(select, relationsOptions)).toEqual({ id: true, address: true, posts: false });
            expect(parsePrismaSelect({ id: true }, relationsOptions)).toEqual({ id: true });
        });

        it("should return the same as without relationsOptions when they are not provided", () => {
            const select: VSRepoSelect<User> = { id: true, posts: { tags: { category: true }, title: true } };

            expect(parsePrismaSelect(select, undefined)).toEqual(parsePrismaSelect(select));
            expect(parsePrismaSelect(select, {})).toEqual(parsePrismaSelect(select));
        });

        it("should translate the where for the provider", () => {
            const select: VSRepoSelect<User> = { posts: true };
            const relationsOptions: VSRepoRelationsOptions<User> = {
                posts: { where: { title: { contains: "a", ignoreCase: true } } },
            };

            expect(parsePrismaSelect(select, relationsOptions, "cockroachdb")).toEqual({
                posts: { where: { title: { contains: "a", mode: "insensitive" } } },
            });
            expect(() => parsePrismaSelect(select, relationsOptions, "mysql")).toThrow(
                expect.objectContaining({ code: AdapterErrorCode.NOT_SUPPORTED }),
            );
        });
    });
});
