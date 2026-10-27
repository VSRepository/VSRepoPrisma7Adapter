import { AdapterErrorCode, VSRepoAdapterError } from "vsrepo";
import { validatePrismaClient } from "./validate-prisma-client.validator.js";

describe("validatePrismaClient", () => {
    it("should correctly validate the provided prisma client", () => {
        const prisma = { user: {} };

        validatePrismaClient(prisma, "user");
    });

    it("should throw VSRepoAdapterError if prisma is undefined", () => {
        let thrown: any;

        try {
            validatePrismaClient(undefined, "user");
        } catch (err) {
            thrown = err;
        }

        expect(thrown).toBeInstanceOf(VSRepoAdapterError);
        expect(thrown.code).toBe(AdapterErrorCode.MISSING_DB_CLIENT);
    });

    it("should throw VSRepoAdapterError if prisma is null", () => {
        let thrown: any;

        try {
            validatePrismaClient(null, "user");
        } catch (err) {
            thrown = err;
        }

        expect(thrown).toBeInstanceOf(VSRepoAdapterError);
        expect(thrown.code).toBe(AdapterErrorCode.MISSING_DB_CLIENT);
    });

    it("should throw VSRepoAdapterError if the model is null", () => {
        let thrown: any;

        try {
            const prisma = { user: null };
            validatePrismaClient(prisma, "user");
        } catch (err) {
            thrown = err;
        }

        expect(thrown).toBeInstanceOf(VSRepoAdapterError);
        expect(thrown.code).toBe(AdapterErrorCode.MODEL_NOT_FOUND);
    });

    it("should throw VSRepoAdapterError if the model is not an object", () => {
        let thrown: any;

        try {
            const prisma = { user: "user" };
            validatePrismaClient(prisma, "user");
        } catch (err) {
            thrown = err;
        }

        expect(thrown).toBeInstanceOf(VSRepoAdapterError);
        expect(thrown.code).toBe(AdapterErrorCode.MODEL_NOT_FOUND);
    });
});
