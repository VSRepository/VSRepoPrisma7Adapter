import { Ordering } from "vsrepo";
import { parsePrismaOrderBy } from "./order-by.parser.js";

interface User {
    id: string;
    name: string;
    posts: { title: string; tags: { name: string; category: { name: string } }[] }[];
    address: { city: string; state: string };
}

describe("parsePrismaOrderBy", () => {
    it("should convert an Ordering to a valid Prisma orderBy", () => {
        const order: Ordering<User> = { id: "ASC", name: "DESC" };

        const result = parsePrismaOrderBy(order);

        expect(result).toEqual({ id: "asc", name: "desc" });
    });

    it("should convert an Ordering array to a valid Prisma orderBy", () => {
        const order: Ordering<User> = [{ id: "ASC" }, { name: "desc" }];

        const result = parsePrismaOrderBy(order);

        expect(result).toEqual([{ id: "asc" }, { name: "desc" }]);
    });

    it("should convert a nested Ordering to a valid Prisma orderBy", () => {
        const order = {
            name: "ASC",
            address: {
                state: "DESC",
            },
        } as Ordering<User>;

        const result = parsePrismaOrderBy(order);

        expect(result).toEqual({
            name: "asc",
            address: {
                state: "desc",
            },
        });
    });
});
