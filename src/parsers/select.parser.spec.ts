import { VSRepoSelect } from "vsrepo";
import { parsePrismaSelect } from "./select.parser.js";

interface User {
    id: string;
    name: string;
    posts: { title: string; tags: { name: string; category: { name: string } }[] }[];
    address: { city: string; state: string };
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
});
