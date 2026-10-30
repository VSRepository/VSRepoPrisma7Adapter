import { AdapterErrorCode, VSRepoAdapterError } from "vsrepo";
import { resolveProvider } from "./resolve-provider.resolver.js";

describe("resolveProvider", () => {
    it("should respect the override", () => {
        const prisma = { _engineConfig: { activeProvider: "cockroachdb" } };

        const result = resolveProvider(prisma, "postgresql");

        expect(result).toBe("postgresql");
    });

    it("should infer the provider by _engineConfig.activeProvider first", () => {
        const prisma = { _engineConfig: { activeProvider: "cockroachdb", adapter: { provider: "postgresql" } } };

        const result = resolveProvider(prisma);

        expect(result).toBe("cockroachdb");
    });

    it("should infer the provider by _engineConfig.adapter.provider for fallback", () => {
        const prisma = { _engineConfig: { activeProvider: undefined, adapter: { provider: "postgres" } } };

        const result = resolveProvider(prisma);

        expect(result).toBe("postgresql");
    });

    it("should throw if no field is valid", () => {
        let thrown: any;

        const prisma = { _engineConfig: { activeProvider: "mongodb", adapter: { provider: "mongodb" } } };

        try {
            resolveProvider(prisma);
        } catch (err) {
            thrown = err;
        }

        expect(thrown).toBeInstanceOf(VSRepoAdapterError);
        expect(thrown.code).toBe(AdapterErrorCode.NOT_SUPPORTED);
    });

    it("should throw if both fields are undefined", () => {
        let thrown: any;

        const prisma = { _engineConfig: { activeProvider: undefined, adapter: { provider: undefined } } };

        try {
            resolveProvider(prisma);
        } catch (err) {
            thrown = err;
        }

        expect(thrown).toBeInstanceOf(VSRepoAdapterError);
        expect(thrown.code).toBe(AdapterErrorCode.NOT_SUPPORTED);
    });
});
