import "dotenv/config";
import { defineAdapterIntegrationSuite } from "../shared/adapter-integration.suite.js";
import { getSqlServerPlaceholder } from "vsrepo";

defineAdapterIntegrationSuite({
    name: "SQL Server",
    provider: "sqlserver",
    load: async () => (await import("./prisma-sqlserver.js")).prismaSqlServer,
    capabilities: {
        returningMany: false,
        skipDuplicates: false,
        insensitiveMode: false,
        isolatedReadsDuringTransaction: false,
    },
    quote: table => `[${table}]`,
    placeholder: getSqlServerPlaceholder,
});
