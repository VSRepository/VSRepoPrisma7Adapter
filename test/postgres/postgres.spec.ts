import "dotenv/config";
import { defineAdapterIntegrationSuite } from "../shared/adapter-integration.suite.js";
import { getPostgresPlaceholder } from "vsrepo";

defineAdapterIntegrationSuite({
    name: "PostgreSQL",
    provider: "postgresql",
    load: async () => (await import("./prisma-postgres.js")).prismaPostgres,
    capabilities: {
        returningMany: true,
        skipDuplicates: true,
        insensitiveMode: true,
        isolatedReadsDuringTransaction: true,
    },
    quote: table => `"${table}"`,
    placeholder: getPostgresPlaceholder,
});
