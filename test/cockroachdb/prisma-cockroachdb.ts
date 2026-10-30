import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../prisma/cockroachdb/generated/prisma/client.js";

const adapter = new PrismaPg({ connectionString: process.env.COCKROACHDB_URL });
const prismaCockroachdb = new PrismaClient({ adapter });

export { prismaCockroachdb };
