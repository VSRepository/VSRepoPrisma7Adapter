import { AdapterErrorCode, VSRepoAdapterError } from "vsrepo";
import { validatePrismaClient } from "./validate-prisma-client.validator.js";

describe("validatePrismaClient", () => {
    it("should correctly validate the provided prisma client", () => {
        const prisma = { user: { fields: { id: {}, name: {} } } };

        validatePrismaClient(prisma, "user", "id");
    });

    it("should throw VSRepoAdapterError if prisma is undefined", () => {
        let thrown: any;

        try {
            validatePrismaClient(undefined, "user", "id");
        } catch (err) {
            thrown = err;
        }

        expect(thrown).toBeInstanceOf(VSRepoAdapterError);
        expect(thrown.code).toBe(AdapterErrorCode.MISSING_DB_CLIENT);
    });

    it("should throw VSRepoAdapterError if prisma is null", () => {
        let thrown: any;

        try {
            validatePrismaClient(null, "user", "id");
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
            validatePrismaClient(prisma, "user", "id");
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
            validatePrismaClient(prisma, "user", "id");
        } catch (err) {
            thrown = err;
        }

        expect(thrown).toBeInstanceOf(VSRepoAdapterError);
        expect(thrown.code).toBe(AdapterErrorCode.MODEL_NOT_FOUND);
    });

    it("should throw MODEL_NOT_FOUND if the model delegate has no fields metadata", () => {
        let thrown: any;

        try {
            const prisma = { user: {} };
            validatePrismaClient(prisma, "user", "id");
        } catch (err) {
            thrown = err;
        }

        expect(thrown).toBeInstanceOf(VSRepoAdapterError);
        expect(thrown.code).toBe(AdapterErrorCode.MODEL_NOT_FOUND);
        expect(thrown.message).toContain("fields");
    });

    it("should throw FIELD_NOT_FOUND if pkName is not a field of the model", () => {
        let thrown: any;

        try {
            const prisma = { user: { fields: { id: {}, name: {} } } };
            validatePrismaClient(prisma, "user", "uuid");
        } catch (err) {
            thrown = err;
        }

        expect(thrown).toBeInstanceOf(VSRepoAdapterError);
        expect(thrown.code).toBe(AdapterErrorCode.FIELD_NOT_FOUND);
    });

    it("should name the model, the pkName and the available fields in the FIELD_NOT_FOUND message", () => {
        const prisma = { user: { fields: { id: {}, name: {} } } };

        expect(() => validatePrismaClient(prisma, "user", "uuid")).toThrow(
            /pkName.*'uuid'.*model 'user'.*available fields: 'id', 'name'/,
        );
    });

    it("should say 'none' when the model has no fields", () => {
        const prisma = { user: { fields: {} } };

        expect(() => validatePrismaClient(prisma, "user", "id")).toThrow(/available fields: none/);
    });
});
