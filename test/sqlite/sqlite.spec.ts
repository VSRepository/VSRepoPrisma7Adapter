import "dotenv/config";
import { defineAdapterIntegrationSuite } from "../shared/adapter-integration.suite.js";
import { getSqlitePlaceholder } from "vsrepo";

// SQLite needs no server: it always runs (the database file is `dev.db`, see `prisma/sqlite`).
defineAdapterIntegrationSuite({
    name: "SQLite",
    provider: "sqlite",
    load: async () => (await import("./prisma-sqlite.js")).prismaSqlite,
    capabilities: {
        returningMany: true,
        skipDuplicates: false,
        insensitiveMode: false,
        isolatedReadsDuringTransaction: false,
    },
    quote: table => `"${table}"`,
    placeholder: getSqlitePlaceholder,
});
