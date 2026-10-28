import "dotenv/config";
import { defineAdapterIntegrationSuite } from "../shared/adapter-integration.suite.js";
import { getPostgresPlaceholder } from "vsrepo";

// CockroachDB speaks the PostgreSQL protocol, so this suite is also the reference for it
// (except `ignoreCase`, which the adapter only allows on PostgreSQL itself).
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
