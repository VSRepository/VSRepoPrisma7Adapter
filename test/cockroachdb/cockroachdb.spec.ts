import "dotenv/config";
import { defineAdapterIntegrationSuite } from "../shared/adapter-integration.suite.js";
import { getCockroachPlaceholder } from "vsrepo";

defineAdapterIntegrationSuite({
    name: "CockroachDB",
    provider: "cockroachdb",
    load: async () => (await import("./prisma-cockroachdb.js")).prismaCockroachdb,
    capabilities: {
        returningMany: true,
        skipDuplicates: true,
        insensitiveMode: true,
        isolatedReadsDuringTransaction: false,
    },
    quote: table => `"${table}"`,
    placeholder: getCockroachPlaceholder,
});
