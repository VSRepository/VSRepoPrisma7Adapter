import "dotenv/config";
import { PrismaMssql } from "@prisma/adapter-mssql";
import { PrismaClient } from "../../prisma/sqlserver/generated/prisma/client.js";

const adapter = new PrismaMssql({
    user: process.env.SQLSERVER_USER,
    password: process.env.SQLSERVER_PASSWORD,
    database: process.env.SQLSERVER_NAME,
    server: process.env.SQLSERVER_HOST!,
    pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000,
    },
    options: { trustServerCertificate: true },
});
const prismaSqlServer = new PrismaClient({ adapter });

export { prismaSqlServer };
