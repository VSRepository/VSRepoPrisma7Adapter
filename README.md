<div align="center">
  <img src="https://res.cloudinary.com/ddbfifdxd/image/upload/w_200,q_auto,f_auto/v1786386427/VS_logo_TextoAbaixo_yev4tq.png" alt="VSRepository Logo" width="200"/>

  <p style="margin-top: 12px;">
    <img src="https://img.shields.io/npm/v/@vsrepo/prisma7-adapter?style=flat-square" alt="npm version"/>
    <img src="https://img.shields.io/npm/l/@vsrepo/prisma7-adapter?style=flat-square" alt="npm license"/>
    <img src="https://img.shields.io/npm/dt/@vsrepo/prisma7-adapter?style=flat-square" alt="npm downloads"/>
    <img src="https://img.shields.io/badge/inspired%20by-JpaRepository-E73121?style=flat-square" alt="inspired by JpaRepository"/>
  </p>
</div>

# VSRepoPrisma7Adapter

🇧🇷 [Ler em português](./README.pt-BR.md)

> 🚧 **In development.** This is the `v2` of `@vsrepo/prisma7-adapter`, targeting [VSRepository v3](https://github.com/VSRepository/VSRepository). It's a development version, not a stable release yet, so its API may still change. For VSRepository v2, use the 1.x line (latest: `1.3.2`). It's currently the only officially supported adapter — adapters for other ORMs are planned but not published yet (see [Adapter status](https://github.com/VSRepository/VSRepository#adapter-status) in the VSRepository README).

`VSRepoAdapter` implementation for [VSRepository v3](https://github.com/VSRepository/VSRepository) backed by [Prisma 7](https://www.prisma.io/). It translates every `VSRepository` operation into Prisma Client calls, resolving `VSRepoWhere`, `Ordering`, `select`/`relations` through dedicated parsers, and — when a `relations` config is provided — resolving relation fields on `create`/`update`/`upsert`/`save`.

---

## Table of contents

- [Installation](#installation)
- [Basic usage](#basic-usage)
- [Constructor config](#constructor-config)
- [Global config](#global-config)
- [Relations](#relations)
    - [The two `relations`](#the-two-relations)
    - [`relations` in the constructor (write)](#relations-in-the-constructor-write)
        - [`mode`](#mode)
        - [`pk`](#pk)
        - [`onUpdate`](#onupdate)
        - [`onDisconnect`](#ondisconnect)
        - [Ignoring a relation (`"ignore"`)](#ignoring-a-relation-ignore)
        - [`fkHere` and `fkThere`](#fkhere-and-fkthere)
        - [`allowOmitPk`](#allowomitpk)
        - [How each write method resolves relations](#how-each-write-method-resolves-relations)
    - [`relations` in method options (read)](#relations-in-method-options-read)
- [Atomic and aggregation methods](#atomic-and-aggregation-methods)
- [`createMany`/`createManyReturning`/`updateMany`/`updateManyReturning` don't support nested writes](#createmanycreatemanyreturningupdatemanyupdatemanyreturning-dont-support-nested-writes)
- [Provider-specific limitations](#provider-specific-limitations)
- [Transactions](#transactions)
- [Logging](#logging)
- [Requirements](#requirements)

---

## Installation

```bash
npm install vsrepo@dev @prisma/client @vsrepo/prisma7-adapter@dev
```

While `2.0.0` is in development, install both `vsrepo` and `@vsrepo/prisma7-adapter` with the `dev` tag.

## Basic usage

```typescript
import { VSRepository, VSLogLevel } from "vsrepo";
import { Prisma7Adapter, Prisma7OrmTypes } from "@vsrepo/prisma7-adapter";
import { Prisma, PrismaClient } from "./generated/prisma/client";
import { prisma } from "./prisma";

type User = Prisma.UserGetPayload<{ include: { posts: true } }>;
type MyOrmTypes = Prisma7OrmTypes<PrismaClient>;

class UserRepository extends VSRepository<User, string, MyOrmTypes> {
    constructor() {
        super({
            adapter: new Prisma7Adapter(prisma, {
                modelName: "user",
                pkName: "id",
                relations: {
                    posts: { mode: "otm", pk: "id" },
                },
                logLevel: VSLogLevel.WARN,
            }),
        });
    }
}

const userRepository = new UserRepository();

const user = await userRepository.get("...", { relations: { posts: true } }); // by primary key
```

Here the `relations` you pass in the method `options` — shaped like `{ field: true }` — is transformed into a Prisma `include` by the adapter (see [`relations` in method options (read)](#relations-in-method-options-read)). If you supply `select`, the `relations`/`include` is ignored. Don't confuse it with the constructor-config `relations`, which describes how relation fields are resolved in write payloads — the difference is explained in [The two `relations`](#the-two-relations).

`Prisma7OrmTypes<DB>` ties `VSRepository`'s `getDbClient()`/`transaction()` return types to your real, generated Prisma types — see [Transactions](#transactions).

## Constructor config

```typescript
new Prisma7Adapter(prisma, {
    modelName: "user", // required — the Prisma Client model/delegate name, as in `prisma.user`
    pkName: "id",       // required — the entity's primary key field name
    relations: { ... }, // optional — see "relations in the constructor (write)" below
    provider: "postgresql", // optional — detected from the Prisma Client when omitted
    logLevel: VSLogLevel.WARN, // optional — default: VSLogLevel.WARN
    allowOmitPk: false, // optional — default: false. Read "`allowOmitPk`" before turning it on
});
```

At construction, the adapter checks the Prisma Client and the model, and resolves the datasource provider:

- a `null`/`undefined` client throws a `VSRepoAdapterError` (code `MISSING_DB_CLIENT`);
- a `modelName` with no matching delegate on the client (`prisma.<modelName>`) throws `MODEL_NOT_FOUND`;
- the provider comes from `provider` when set; otherwise it's detected from the generated client (`_engineConfig.activeProvider`, falling back to the driver adapter's `provider`). If it can't be detected, construction throws `NOT_SUPPORTED` — set `provider` explicitly in that case (one of `postgresql`, `cockroachdb`, `mysql`, `sqlite`, `sqlserver`).

The other fields (`pkName`, `relations`, `logLevel`, `allowOmitPk`) are checked by TypeScript only, not at runtime.

## Global config

`provider`, `logLevel` and `allowOmitPk` can be set once for every adapter, through the static `setGlobalConfig`:

```typescript
import { VSLogLevel } from "vsrepo";
import { Prisma7Adapter } from "@vsrepo/prisma7-adapter";

Prisma7Adapter.setGlobalConfig({ logLevel: VSLogLevel.WARN });
```

- It only affects adapters created **after** the call, so call it before instantiating your repositories.
- Each call **replaces** the previous global config — it doesn't merge with it.
- A value set in an adapter's own config always wins over the global one.

## Relations

### The two `relations`

The name `relations` appears in **two different places** in the API, with **different shapes and purposes** — easy to confuse. In a nutshell:

|                       | `relations` in the **constructor**                                                                                                                                                                                                  | `relations` in **method options**                                                                    |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Where you define it   | `new Prisma7Adapter(prisma, { relations: ... })`                                                                                                                                                                                    | `repository.get(where, { relations: ... })` — and other methods                                      |
| Shape                 | One **config object** per field (`{ mode, pk, onUpdate?, onDisconnect?, fkHere?, fkThere? }`), or `"ignore"`                                                                                                                        | One **`true`/sub-object** per field: `{ posts: true }`                                               |
| Purpose               | **Write** — when a `create`/`update`/`upsert`/`save` payload contains a relation field, tells the adapter how to turn it into a Prisma nested write (`create`/`connect`/`connectOrCreate`/`upsert`/`disconnect`/`deleteMany`/`set`) | **Read** — eager loading: which relations to fetch alongside the result (becomes a Prisma `include`) |
| Consumed by           | `parsePrismaWriteData` (write resolver)                                                                                                                                                                                             | `parsePrismaInclude` (via `resolveReadArg`)                                                          |
| Depends on the other? | No — it only affects writes                                                                                                                                                                                                         | No — it works even with no `relations` in the constructor                                            |

Neither depends on the other: the method-options `relations` does eager loading even when the constructor has no `relations`, and the constructor `relations` governs write behavior even if you never pass `relations` in options. The two subsections below cover each one.

### `relations` in the constructor (write)

The `relations` config on the constructor describes, for each relation field of your entity, **how the adapter should resolve that field when it shows up in write payloads** (`create`/`update`/`upsert`/`save`).

Each relation is configured by its field name:

```typescript
relations: {
    posts: { mode: "otm", pk: "id", onUpdate: "set" },
    address: { mode: "oto", pk: "id", onUpdate: "upsert", onDisconnect: "delete" },
    author: { mode: "mto", pk: "id" }, // every option has a default
    audit: "ignore", // never written through this repository
}
```

Without `relations`, every field — including relation fields — is passed straight through to Prisma's `where`/`data`/`create`/`update`, as-is. That's fine for scalar fields, but Prisma expects a very specific nested-write shape (`create`/`connectOrCreate`/`upsert`/`disconnect`/`deleteMany`/`set`) for relation fields, so if your entity has relations you'll usually want to configure them.

#### `mode`

Cardinality of the relation, from the point of view of the entity that owns the field:

| `mode` | Meaning      | Field shape you send       | Options                                                                                    |
| ------ | ------------ | -------------------------- | ------------------------------------------------------------------------------------------ |
| `oto`  | one-to-one   | a single object, or `null` | `pk`, `onUpdate` (to-one), `onDisconnect` (`"disconnect"`/`"delete"`), `fkHere`, `fkThere` |
| `mto`  | many-to-one  | a single object, or `null` | `pk`, `onUpdate` (to-one), `onDisconnect` (`"disconnect"`/`"delete"`), `fkHere`, `fkThere` |
| `otm`  | one-to-many  | an array of objects        | `pk`, `onUpdate` (to-many), `fkThere`                                                      |
| `mtm`  | many-to-many | an array of objects        | `pk`, `onUpdate` (to-many), `fkThere`                                                      |

#### `pk`

The field used to identify an existing related record. An item **with** `pk` in the payload is connected to (or upserted into) the existing record; an item **without** it is created.

#### `onUpdate`

How `save`/`update`/`upsert` write the relation on update. The values accepted depend on the `mode`.

**To-one (`oto`/`mto`)**, when the related object has its `pk`:

- **`"connect"`** never creates nor overwrites the related record: it only points the relation to it.
- **`"connectOrCreate"`** creates the related record when it is missing.
- **`"upsert"`** is the one that **overwrites** the related record with the fields you sent.
- When the owner record itself is being created (`create`, or the `create` branch of `save`), a related object with `pk` always becomes a `connectOrCreate`.

**To-many (`otm`/`mtm`)**, for the items that already exist (matched by `pk`) and for the ones that were **not** sent:

- **`"add"`** (default) — only creates/connects/upserts the items you send. Existing items that aren't in the payload are left untouched.
- **`"set"`** — same as `"add"`, but also removes what wasn't sent: `otm` runs a `deleteMany` on the items missing from the array, and `mtm` resets the join (`set: []`) before reconnecting.

#### `onDisconnect`

What sending `null` to a to-one relation does on update:

- **`"disconnect"`** (default) — detaches the related record and keeps it. Prisma rejects it when the relation is required.
- **`"delete"`** — deletes the related record. Available for `oto` and `mto`, and always opt-in. Be careful on an `mto`: the related record is shared with other rows, so deleting it affects all of them, and Prisma rejects the write while other rows still reference it (unless the FK has a referential action such as `onDelete: Cascade`).

#### Ignoring a relation (`"ignore"`)

Setting a relation to `"ignore"` leaves that field out of every write (`create`, `update`, `save`...): the object (or array) is simply dropped. It is useful for a relation you **load** but don't want to **persist** through this entity.

```typescript
// AddressRepository
relations: {
    user: "ignore";
}
```

Since the relation object is dropped, a scalar FK in the payload (`userId`) goes through as is, together with the primary key. That makes it the simplest way around the [`allowOmitPk` problem](#allowomitpk) when you only want to keep the FK: `address.save(addressLoadedWithItsUser)` updates the address and never touches the user.

#### `fkHere` and `fkThere`

In a one-to-one or many-to-one relation, only one side keeps the foreign key column. For `Address.user`, that's `Address.userId`. Tell the adapter which side each entity is on:

| Entity                 | Relation field | Holds the FK?                                       | Config              |
| ---------------------- | -------------- | --------------------------------------------------- | ------------------- |
| `Address` (owner side) | `user`         | **yes** — `userId` is a column of `Address`         | `fkHere: "userId"`  |
| `User` (inverse side)  | `address`      | no — the FK lives in the related entity (`Address`) | `fkThere: "userId"` |

```typescript
// UserRepository
relations: { address: { mode: "oto", pk: "id", fkThere: "userId" } }

// AddressRepository
relations: { user: { mode: "oto", pk: "id", fkHere: "userId" } }
```

- **`fkThere`** — name of the FK that lives in the **related** entity. A related object loaded with `get`/`find` usually carries it (`address: { id, street, userId }`), but the relation already sets it, and Prisma doesn't accept it inside the nested write. The adapter strips it from the related payload(s) before building the write.
- **`fkHere`** — name of the FK that lives in **this** entity. Prisma doesn't accept the scalar FK together with the relation object, so when the relation field is in the payload the adapter drops this field from `create` and `update`. A payload that carries only the scalar FK (and no relation object) is left as it is.

`fkHere` has one more consequence, for the primary key — read the next section.

#### `allowOmitPk`

`allowOmitPk` is an adapter option (it can also be set in the [global config](#global-config)), but it only matters for relations configured with `fkHere`.

**The problem.** Take an `Address` loaded together with its `user` (`relations: { user: true }`) and sent back to `save`. The payload has the primary key (`id`) **and** a relation that holds its FK in the entity itself. Once the relation object is there, Prisma won't take the scalar FK nor the primary key (`Unknown argument 'id'`), so the adapter can't send everything.

**What the adapter does:**

- **`allowOmitPk: false`** (default) — throws a `VSRepoAdapterError` (`INVALID_DATA`) **before** touching the database, explaining what to do. Payloads without a primary key (e.g. a plain `create`), or without the relation object, are not affected.
- **`allowOmitPk: true`** — drops the primary key from `create` and `update`. Records that already exist are still found through `where: { id }`, so **updates work normally**. The catch is the `create` branch of `save`: if the record doesn't exist yet, it is created with a **database-generated primary key, not the one you sent** — and nothing warns you.

**When to turn it on.** Only if you really need it, and only if it's not your application that manages the ids — i.e. the database generates them (`autoincrement`, `uuid()`/`cuid()` defaults, sequences...). If your application assigns the ids (client-generated UUIDs, ids imported from another system, ids that other records already reference), keep it **off**: a record that doesn't exist would silently be stored under a different id.

**Ways around it, without `allowOmitPk`:**

1. **Ignore the relation** when you only want to keep the FK: `relations: { user: "ignore" }` (see [Ignoring a relation](#ignoring-a-relation-ignore)). The payload keeps `id` and `userId`, and the related entity is not written.
2. **Send the scalar FK instead of the relation object.** `address.save({ id, city, userId })` keeps both `id` and `userId`, since there's no relation object. Persist the related entity on its own (through its repository) when it also changed — ideally in one `transaction`.
3. **Send only what changed.** `address.update({ id }, { city })` carries neither the primary key nor the relation.
4. **Save from the other side.** `user.save({ ...user, address })` keeps the primary keys (configure `fkThere` there): the FK lives in `Address`, so `User` has no FK of its own to conflict with.
5. **Let the database generate the key for new records.** Don't send `id` when creating: `address.create({ city, user })`.

#### How each write method resolves relations

| Method                                                                      | Relations                                                                                                                                     |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `create`                                                                    | `create`/`connectOrCreate` only (no upsert — there's nothing to update yet)                                                                   |
| `update` / `upsert` (`update` half) / `save` (upsert branch)                | Full resolution: `create`/`connect`/`connectOrCreate`/`upsert`/`disconnect`/`delete`/`deleteMany`/`set`, per `mode`/`onUpdate`/`onDisconnect` |
| `createMany` / `createManyReturning` / `updateMany` / `updateManyReturning` | Not supported — throws a `VSRepoAdapterError` naming the offending field if the payload contains a configured relation                        |

### `relations` in method options (read)

This is the `relations` you pass in the `options` of a `VSRepository` method (`get`, `find`, `findOne`, etc.). The shape is much simpler: an object where each relation field accepts:

- `true` — load the relation as-is;
- or another `relations` object — for nested eager loading (relations of the relation).

```typescript
const user = await userRepository.get(
    "...", // primary key
    {
        relations: {
            posts: true, // fetch posts along
            author: { profile: true }, // and, inside author, its profile (nested eager loading)
        },
    },
);
```

This object is turned into a Prisma `include` by the adapter (`parsePrismaInclude`). It does **not** use the constructor's `relations` config: it's purely a read-side option and works even with no `relations` in the config.

The `select` and `relations` you pass in the options are turned into a Prisma `select` (`parsePrismaSelect`) and a Prisma `include` (`parsePrismaInclude`), respectively. When `select` is provided, the `include` derived from `relations` is discarded (`undefined`), because Prisma doesn't allow combining `include` and `select` in a single query. In other words, if you're already using `select`, the `relations` object becomes redundant — so it's optional. Here's the resolved logic (from `resolveReadArg`):

```ts
const prismaSelect = options.select && parsePrismaSelect(options.select);
const prismaInclude = prismaSelect ? undefined : options.relations && parsePrismaInclude(options.relations);
```

## Atomic and aggregation methods

The adapter implements the 12 abstract methods `VSRepository`'s `increment`/`decrement`/`multiply`/`divide`, their `*Many` counterparts, and `sum`/`average`/`min`/`max` delegate to: `incrementOne`, `decrementOne`, `multiplyOne`, `divideOne`, `incrementMany`, `decrementMany`, `multiplyMany`, `divideMany`, `sum`, `average`, `min`, `max`.

- `incrementOne`/`decrementOne`/`multiplyOne`/`divideOne` translate directly into Prisma's native single-field atomic write — `data: { [field]: { increment: value } }` (and `decrement`/`multiply`/`divide`) — so the operation is evaluated **server-side** against the row's _current_ value (`UPDATE ... SET field = field + value`), not as a fetch-then-save round trip on the client. Prisma's `update()` already returns the row reflecting the state _after_ the write, so the adapter never issues a follow-up read.
- `incrementMany`/`decrementMany`/`multiplyMany`/`divideMany` apply that same native write to **every** record matching `where`, through Prisma's `updateMany`, also evaluated server-side. They return a `{ count }` (`CountResult`) instead of the records.
- `sum`/`average`/`min`/`max` translate into Prisma's `aggregate()` with `_sum`/`_avg`/`_min`/`_max: { [field]: true }`. The raw result (`number`, `bigint`, a `Decimal` instance, or `null`) is normalized to `number | null` — `null` is returned as-is (mirroring SQL's `SUM()`/`AVG()`/`MIN()`/`MAX()`, which return `NULL`, not `0`, over an empty set), and a `Decimal`/`DecimalLike` value is converted via its `.toNumber()`.

```typescript
// Atomic — evaluated server-side, no read-modify-write:
await productRepository.increment("stock", 10, { id: productId });
await accountRepository.decrement("balance", 50, { id: accountId });
await productRepository.multiply("price", 1.1, { id: productId }); // e.g. a 10% price bump
await productRepository.divide("price", 2, { id: productId });

// Same, for every record matching `where` — returns `{ count }`:
await productRepository.incrementMany("stock", 10, { category: "books" });

// Aggregation — across every record matching an optional `where` (all if omitted):
const total = await productRepository.sum("price"); // number | null
const avgPrice = await productRepository.average("price", { active: true });
const cheapest = await productRepository.min("price");
const mostExpensive = await productRepository.max("price");
```

**Decimal fields** (`Prisma.Decimal`) are fully supported as the `field` for all of these methods — `value` for the atomic methods is passed straight through to Prisma (which accepts a `number`, `string`, or `Decimal`/`DecimalJsLike`), and the aggregate methods always normalize the result to a `number`, never a `Decimal` instance.

## `createMany`/`createManyReturning`/`updateMany`/`updateManyReturning` don't support nested writes

`createMany`, `createManyReturning`, `updateMany` and `updateManyReturning` only accept scalar fields in their `data`. If your payload includes a field configured in `relations` (regardless of its value), the adapter throws a `VSRepoAdapterError` naming the offending field. For a full nested write, use `create`/`update`/`save` one record at a time, or wrap several `save` calls in a `saveMany`/`transaction`.

> Note on return order: `createManyReturning` and `updateManyReturning` don't guarantee the returned records follow the order of the input payload (`objs`). Without `select`/`relations` they are a single `createManyAndReturn`/`updateManyAndReturn` call; with them, the result comes from a second `findMany` (re-querying the inserted/updated rows by primary key, inside a transaction). Either way, don't rely on the order matching the input.

## Provider-specific limitations

Some features this adapter relies on aren't available on every database provider. The adapter checks every feature below upfront and throws a `VSRepoAdapterError` (code `NOT_SUPPORTED`) before touching the database.

| Feature                                                                                                       | Supported providers             | Not supported                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ignoreCase` (translated to Prisma's `mode: "insensitive"`; used by `findByXIgnoreCase` dynamic methods)      | PostgreSQL, CockroachDB         | MySQL, SQLite, SQL Server — MySQL and SQL Server are case-insensitive by default (depending on the collation), so no `mode` is needed there; SQLite is only case-insensitive for ASCII characters |
| `createManyReturning` / `updateManyReturning` (built on Prisma's `createManyAndReturn`/`updateManyAndReturn`) | PostgreSQL, CockroachDB, SQLite | MySQL, SQL Server                                                                                                                                                                                 |
| `ignoreConflicts: true` on `createMany` / `createManyReturning` (Prisma's `skipDuplicates`)                   | PostgreSQL, MySQL, CockroachDB  | SQL Server, SQLite                                                                                                                                                                                |

The `like` operator isn't supported on any provider — Prisma has no equivalent, so the adapter throws `NOT_SUPPORTED`. Use `contains`, `startsWith` or `endsWith` instead.

> These limitations come from Prisma itself, not from this adapter — see [Prisma's case sensitivity docs](https://www.prisma.io/docs/orm/v7/reference/prisma-client-reference#mode) and [CRUD reference](https://www.prisma.io/docs/orm/v7/prisma-client/queries/crud) for details. The adapter is covered by integration tests on PostgreSQL, MySQL, SQLite, SQL Server and CockroachDB.

## Transactions

**Every** method accepts `options.db` and runs its operation on the client/transaction you pass — the difference is in **how** each one treats it:

- Most methods (single, one-call Prisma operations) simply run directly on `options?.db`: hand them a transaction client and the call participates in that transaction, starting nothing new.
- `saveMany` and `deleteManyReturning` — and `updateManyReturning`/`createManyReturning` when you pass `select` or `relations` — need to run **more than one** Prisma operation atomically (`saveMany` saves each record individually; `updateManyReturning`/`createManyReturning` do an `updateManyAndReturn`/`createManyAndReturn` + `findMany`; `deleteManyReturning` does a `findMany` + `deleteMany`), so they go through `runTransactional`. Without `select`/`relations`, `updateManyReturning`/`createManyReturning` are a single Prisma call. If `options.db` is already an active transaction client, it's reused — no nested transaction is started; otherwise, a new transaction is created (on `options.db` if provided, or on the root client otherwise).

A transaction client is told apart from the root `PrismaClient` by the `$on` method: Prisma's root client exposes it (for event listeners), the interactive transaction client doesn't. This is what `Prisma7ClientLike`/`Prisma7OrmTypes` encode in their types.

```typescript
await userRepository.transaction(async tx => {
    // Every repository call made with `{ db: tx }` inside this callback
    // shares the same transaction — including calls to `saveMany`/
    // `updateManyReturning`/`createManyReturning`/`deleteManyReturning`, which
    // will detect `tx` is already a transaction and run directly on it instead
    // of nesting a new one.
    await userRepository.save(user, { db: tx });
    await userRepository.save(otherUsers, { db: tx }); // an array saves several records
});
```

### Concurrency in `deleteManyReturning`

`deleteManyReturning` runs a `findMany` on the given `where` (to capture the records it will return) and then deletes **those same records by primary key** with a `deleteMany`, all inside one transaction. Prisma has no native `deleteManyAndReturn`, which is why it takes these two steps. If your `select` leaves the primary key out, the adapter adds it to the query internally and strips it from the returned records.

Since the delete is driven by the primary keys that were actually fetched, a row **inserted after** the `findMany` is never deleted by mistake. A concurrent change between the two steps can still make them diverge, though:

- a returned row that was **deleted by someone else** in the meantime is still returned, even though this call didn't delete it;
- a returned row that **stops matching** the `where` before the `deleteMany` runs is still deleted, since the `where` isn't re-applied.

If you need to guarantee there are no concurrency issues, run this method inside a `repository.transaction()` at a higher isolation level — e.g. `SERIALIZABLE`:

```typescript
import { VSRepoIsolationLevel } from "vsrepo";

await userRepository.transaction(async tx => {
    // Atomic: no concurrent insert/update can slip between the findMany
    // and the deleteMany, since SERIALIZABLE isolates this transaction.
    // Always pass `{ db: tx }` so the call runs inside this transaction.
    const deleted = await userRepository.deleteManyReturning({ id: { in: [...] } }, { db: tx });
}, {
    isolationLevel: VSRepoIsolationLevel.SERIALIZABLE,
});
```

> The isolation level applies only when the repository call actually runs **inside** that transaction (i.e. with `{ db: tx }`). When `deleteManyReturning` starts its own internal transaction (no `options.db` passed), it falls back to the default isolation level.

## Logging

The adapter uses `VSLogger` (from `vsrepo`) internally: every method logs a `DEBUG` line with the resolved Prisma arg, and start/end performance logs. Set `logLevel` in the constructor config to control verbosity; it defaults to `VSLogLevel.WARN`.

## Requirements

- `vsrepo` ^3.0.0-dev.2
- `@prisma/client` ^7.10.1
- Node.js `>=22`
- A PostgreSQL, CockroachDB, MySQL, SQLite or SQL Server database (all covered by the integration tests)
