import { VSRepoRelations } from "vsrepo";
import { parsePrismaInclude } from "./include.parser.js";

interface User {
    id: string;
    name: string;
    posts: { title: string; tags: { name: string; category: { name: string } }[] }[];
    address: { city: string; state: string };
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
});
