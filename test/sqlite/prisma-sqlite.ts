import "dotenv/config";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../../prisma/sqlite/generated/prisma/client.js";

const adapter = new PrismaBetterSqlite3({ url: "file:./dev.db" });
const prismaSqlite = new PrismaClient({ adapter });

export { prismaSqlite };
