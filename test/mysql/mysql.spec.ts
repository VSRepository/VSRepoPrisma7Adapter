import "dotenv/config";
import { defineAdapterIntegrationSuite } from "../shared/adapter-integration.suite.js";
import { getMySqlPlaceholder } from "vsrepo";

defineAdapterIntegrationSuite({
    name: "MySQL / MariaDB",
    provider: "mysql",
    load: async () => (await import("./prisma-mysql.js")).prismaMySql,
    capabilities: {
        returningMany: false,
        skipDuplicates: true,
        insensitiveMode: false,
        isolatedReadsDuringTransaction: true,
    },
    quote: table => `\`${table}\``,
    placeholder: getMySqlPlaceholder,
});
