# Integration tests

These tests run the adapter against **real databases**, using the Prisma clients generated from `prisma/<provider>/schema.prisma`. They are separate from the unit tests (`src/**/*.spec.ts`), so `npm test` and the CI never need a database.

```bash
bun run prisma:generate           # generate the four Prisma clients
bun run prisma:migrate            # create the tables in each database
bun run test:integration          # every provider
bun run test:integration:postgres # or: mysql | sqlite | sqlserver
```

Every provider runs the same scenarios (`test/shared/adapter-integration.suite.ts`); what changes per provider is described in `ProviderCapabilities` (e.g. `createManyAndReturn` only exists on PostgreSQL, CockroachDB and SQLite).

| Provider        | Runs when                                                       | Notes                                              |
| --------------- | --------------------------------------------------------------- | -------------------------------------------------- |
| PostgreSQL      | `POSTGRES_URL` is set                                           | Also the reference for CockroachDB                 |
| MySQL / MariaDB | `MYSQL_HOST`, `MYSQL_USER` and `MYSQL_NAME` are set             |                                                    |
| SQL Server      | `SQLSERVER_HOST`, `SQLSERVER_USER` and `SQLSERVER_NAME` are set |                                                    |
| SQLite          | always                                                          | Uses `./dev.db` (apply `prisma/sqlite` migrations) |

A provider whose variables are missing is **skipped**, not failed. See `.env.example`.

> **The tests wipe the data** of the `User`, `Address`, `Post` and `Tag` tables before every test. Point them to a dedicated test database.
