import "dotenv/config";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../../prisma/mysql/generated/prisma/client.js";

const adapter = new PrismaMariaDb({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_NAME,
    port: Number(process.env.MYSQL_PORT ?? 3306),
    connectionLimit: 5,
});
const prismaMySql = new PrismaClient({ adapter });

export { prismaMySql };

await prismaMySql.user.findMany();
