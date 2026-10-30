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

🇺🇸 [Read in English](./README.md)

> 🚧 **Em desenvolvimento.** Esta é a `v2` do `@vsrepo/prisma7-adapter`, feita para o [VSRepository v3](https://github.com/VSRepository/VSRepository). É uma versão de desenvolvimento, ainda não uma release estável, então a API pode mudar. Para o VSRepository v2, use a linha 1.x (última: `1.3.2`). Por enquanto é o único adapter oficialmente suportado — adapters para outros ORMs estão planejados, mas ainda não foram publicados (veja [Status dos adapters](https://github.com/VSRepository/VSRepository/blob/main/README.pt-BR.md#status-dos-adapters) no README do VSRepository).

Implementação de `VSRepoAdapter` para o [VSRepository v3](https://github.com/VSRepository/VSRepository) usando [Prisma 7](https://www.prisma.io/). Traduz toda operação do `VSRepository` em chamadas do Prisma Client, resolvendo `VSRepoWhere`, `Ordering`, `select`/`relations` através de parsers dedicados e — quando uma config de `relations` é fornecida — resolvendo campos de relação em `create`/`update`/`upsert`/`save`.

---

## Sumário

- [Instalação](#instalação)
- [Uso básico](#uso-básico)
- [Config do construtor](#config-do-construtor)
- [Relations](#relations)
  - [Os dois `relations`](#os-dois-relations)
  - [`relations` no construtor (escrita)](#relations-no-construtor-escrita)
    - [`mode`](#mode)
    - [`restriction`](#restriction)
    - [`pk` e `nullable`](#pk-e-nullable)
    - [Como cada método de escrita resolve relations](#como-cada-método-de-escrita-resolve-relations)
  - [`relations` nas options (leitura)](#relations-nas-options-leitura)
- [Métodos atômicos e de agregação](#métodos-atômicos-e-de-agregação)
- [`createMany`/`createManyReturning`/`updateMany`/`updateManyReturning` não suportam nested writes](#createmanycreatemanyreturningupdatemanyupdatemanyreturning-não-suportam-nested-writes)
- [Limitações por provider](#limitações-por-provider)
- [Transactions](#transactions)
- [Logging](#logging)
- [Requisitos](#requisitos)

---

## Instalação

```bash
npm install vsrepo@dev @prisma/client @vsrepo/prisma7-adapter@dev
```

Enquanto a `2.0.0` está em desenvolvimento, instale o `vsrepo` e o `@vsrepo/prisma7-adapter` com a tag `dev`.

## Uso básico

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
                    posts: { mode: "otm", restriction: "add", pk: "id" },
                },
                logLevel: VSLogLevel.WARN,
            }),
        });
    }
}

const userRepository = new UserRepository();

const user = await userRepository.get("...", { relations: { posts: true } }); // pela primary key
```

Aqui, o `relations` passado no `options` do método — com a forma `{ campo: true }` — é transformado num `include` do Prisma pelo adapter (ver [`relations` nas options (leitura)](#relations-nas-options-leitura)). Se você fornecer `select`, o `relations`/`include` é ignorado. Não confunda com o `relations` da config do construtor (que descreve como campos de relação são resolvidos em escritas) — a diferença é explicada em [Os dois `relations`](#os-dois-relations).

`Prisma7OrmTypes<DB>` amarra os tipos de retorno de `getDbClient()`/`transaction()` do `VSRepository` aos seus tipos reais e gerados do Prisma — ver [Transactions](#transactions).

## Config do construtor

```typescript
new Prisma7Adapter(prisma, {
    modelName: "user", // obrigatório — nome do model/delegate do Prisma Client, como em `prisma.user`
    pkName: "id",       // obrigatório — nome do campo de primary key da entidade
    relations: { ... }, // opcional — ver "relations no construtor (escrita)" abaixo
    provider: "postgresql", // opcional — detectado a partir do Prisma Client quando omitido
    logLevel: VSLogLevel.WARN, // opcional — default: VSLogLevel.WARN
});
```

Na construção, o adapter confere o Prisma Client e o model, e resolve o provider do datasource:

- um client `null`/`undefined` lança um `VSRepoAdapterError` (code `MISSING_DB_CLIENT`);
- um `modelName` sem delegate correspondente no client (`prisma.<modelName>`) lança `MODEL_NOT_FOUND`;
- o provider vem do `provider`, quando informado; senão é detectado a partir do client gerado (`_engineConfig.activeProvider`, com fallback pro `provider` do driver adapter). Se não for detectável, a construção lança `NOT_SUPPORTED` — nesse caso, informe o `provider` explicitamente (um de `postgresql`, `cockroachdb`, `mysql`, `sqlite`, `sqlserver`).

Os outros campos (`pkName`, `relations`, `logLevel`) são checados só pelo TypeScript, não em runtime.

## Relations

### Os dois `relations`

O nome `relations` aparece em **dois lugares diferentes** da API, com **formas e propósitos diferentes** — fácil de confundir. Em resumo:

| | `relations` no **construtor** | `relations` nas **options** |
| --- | --- | --- |
| Onde você define | `new Prisma7Adapter(prisma, { relations: ... })` | `repository.get(where, { relations: ... })` — e demais métodos |
| Formato | Um objeto de **configuração** por campo: `{ mode, restriction, pk, nullable? }` | Um objeto por campo **só com `true` ou sub-objeto**: `{ posts: true }` |
| Propósito | **Escrita** — quando um payload de `create`/`update`/`upsert`/`save` tem campo de relação, diz como transformá-lo num nested write do Prisma (`create`/`connectOrCreate`/`upsert`/`disconnect`/`deleteMany`/`set`) | **Leitura** — eager loading: quais relations trazer junto no resultado (vira um `include` do Prisma) |
| Quem consome | `parsePrismaWriteData` (resolver de escrita) | `parsePrismaInclude` (via `resolveReadArg`) |
| Precisa da outra? | Não — só afeta escritas | Não — funciona mesmo sem `relations` no construtor |

Nenhum depende do outro: o `relations` das options faz eager loading de leitura mesmo quando o construtor não tem `relations`; e o `relations` do construtor governa o comportamento de escrita mesmo que você nunca passe `relations` nas options. As duas subseções abaixo detalham cada um.

### `relations` no construtor (escrita)

A config `relations` do construtor descreve, para cada campo de relação da entidade, **como o adapter deve resolver esse campo quando ele aparecer nos payloads de escrita** (`create`/`update`/`upsert`/`save`).

Cada relation é configurada pelo nome do campo:

```typescript
relations: {
    posts: { mode: "otm", restriction: "add", pk: "id" },
    address: { mode: "oto", restriction: "set", pk: "id" },
    author: { mode: "mto", restriction: "set", pk: "id", nullable: true },
}
```

Sem `relations`, todo campo — incluindo campos de relação — é repassado direto pro `where`/`data`/`create`/`update` do Prisma, como está. Isso funciona bem pra campos escalares, mas o Prisma espera um formato bem específico de nested write (`create`/`connectOrCreate`/`upsert`/`disconnect`/`deleteMany`/`set`) pra campos de relação — então, se sua entidade tem relations, normalmente você vai querer configurá-las.

#### `mode`

Cardinalidade da relation, do ponto de vista da entidade dona do campo:

| `mode` | Significado | Formato do campo que você envia |
| --- | --- | --- |
| `oto` | one-to-one | um único objeto, ou `null` |
| `mto` | many-to-one | um único objeto, ou `null` |
| `otm` | one-to-many | um array de objetos |
| `mtm` | many-to-many | um array de objetos |

#### `restriction`

Controla como `save`/`update`/`upsert` tratam itens de relação que já existem (casados pela `pk`) e, pra relations to-many, itens que **não** vieram no payload:

- **`"add"`** — só cria/conecta/faz upsert dos itens enviados. Itens já existentes que não estão no payload permanecem intocados.
- **`"set"`** — igual a `"add"`, mas também remove o que não foi enviado: em `otm` roda um `deleteMany` nos itens que faltam no array; em `mtm` reseta o vínculo (`set: []`) antes de reconectar; em `oto`/`mto` com `nullable: true`, enviar `null` apaga/desconecta a relation (ver abaixo).

#### `pk` e `nullable`

- **`pk`** — o campo usado pra identificar um registro relacionado já existente. Um item **com** `pk` no payload vira um `connectOrCreate`/`upsert`; um item **sem** `pk` vira um `create` simples.
- **`nullable`** — relevante pras relações to-one `oto`/`mto`. Quando `true`, enviar `null` no campo resolve pra `disconnect` no update (`delete` no caso de `oto` com `restriction: "set"` — um lado `oto` não dá só pra "desconectar", a linha possuída é removida). Quando omitido/`false`, enviar `null` numa relação to-one lança um `VSRepoAdapterError` (code `INVALID_DATA`) avisando que a relation não é nullable.

#### Como cada método de escrita resolve relations

| Método | Relations |
| --- | --- |
| `create` | Só `create`/`connectOrCreate` (sem upsert — ainda não existe nada pra atualizar) |
| `update` / `upsert` (metade do `update`) / `save` (branch de upsert) | Resolução completa: `create`/`connectOrCreate`/`upsert`/`disconnect`/`delete`/`deleteMany`/`set`, conforme `mode`/`restriction` |
| `createMany` / `createManyReturning` / `updateMany` / `updateManyReturning` | Não suportado — lança um `VSRepoAdapterError` apontando o campo problemático se o payload tiver uma relation configurada |

### `relations` nas options (leitura)

Esse é o `relations` que você passa no `options` de um método do `VSRepository` (`get`, `find`, `findOne`, etc.). A forma é bem mais simples: um objeto onde cada campo de relação aceita:

- `true` — carrega a relation completa;
- ou outro objeto `relations` — para eager loading aninhado (relations da relation).

```typescript
const user = await userRepository.get(
    "...", // primary key
    {
        relations: {
            posts: true,                   // carrega os posts junto
            author: { profile: true },     // e, dentro do author, o profile (eager loading aninhado)
        },
    }
);
```

Esse objeto é transformado num `include` do Prisma pelo adapter (`parsePrismaInclude`). Ele **não** usa a config `relations` do construtor: é puramente uma opção de leitura e funciona mesmo sem `relations` na config.

O `select` e o `relations` que você passa nas options são transformados num `select` do Prisma (`parsePrismaSelect`) e num `include` (`parsePrismaInclude`), respectivamente. Quando o `select` é fornecido, o `include` derivado do `relations` é descartado (fica `undefined`), porque o Prisma não permite combinar `include` e `select` na mesma query. Ou seja, se você já estiver usando `select`, o objeto `relations` vira redundante — por isso ele é facultativo. Essa é a lógica resolvida (de `resolveReadArg`):

```ts
const prismaSelect = options.select && parsePrismaSelect(options.select);
const prismaInclude = prismaSelect
    ? undefined
    : options.relations && parsePrismaInclude(options.relations);
```

## Métodos atômicos e de agregação

O adapter implementa os 12 métodos abstratos pros quais `increment`/`decrement`/`multiply`/`divide`, suas versões `*Many` e `sum`/`average`/`min`/`max` do `VSRepository` delegam: `incrementOne`, `decrementOne`, `multiplyOne`, `divideOne`, `incrementMany`, `decrementMany`, `multiplyMany`, `divideMany`, `sum`, `average`, `min`, `max`.

- `incrementOne`/`decrementOne`/`multiplyOne`/`divideOne` traduzem direto pra escrita atômica nativa de campo único do Prisma — `data: { [field]: { increment: value } }` (e `decrement`/`multiply`/`divide`) — então a operação é avaliada **server-side** contra o valor *atual* do registro (`UPDATE ... SET field = field + value`), e não como um fetch-then-save no cliente. O `update()` do Prisma já retorna a linha refletindo o estado *após* a escrita, então o adapter nunca precisa fazer uma leitura extra.
- `incrementMany`/`decrementMany`/`multiplyMany`/`divideMany` aplicam essa mesma escrita nativa em **todo** registro que casa com `where`, através do `updateMany` do Prisma, também avaliada server-side. Eles retornam um `{ count }` (`CountResult`) em vez dos registros.
- `sum`/`average`/`min`/`max` traduzem pro `aggregate()` do Prisma, com `_sum`/`_avg`/`_min`/`_max: { [field]: true }`. O resultado bruto (`number`, `bigint`, uma instância de `Decimal`, ou `null`) é normalizado pra `number | null` — `null` é repassado como está (espelhando o `SUM()`/`AVG()`/`MIN()`/`MAX()` do SQL, que retornam `NULL`, não `0`, sobre um conjunto vazio), e um valor `Decimal`/`DecimalLike` é convertido via seu `.toNumber()`.

```typescript
// Atômico — avaliado server-side, sem read-modify-write:
await productRepository.increment("stock", 10, { id: productId });
await accountRepository.decrement("balance", 50, { id: accountId });
await productRepository.multiply("price", 1.1, { id: productId }); // ex: um reajuste de 10% no preço
await productRepository.divide("price", 2, { id: productId });

// O mesmo, pra todo registro que casa com `where` — retorna `{ count }`:
await productRepository.incrementMany("stock", 10, { category: "books" });

// Agregação — entre todos os registros que casam com um `where` opcional (todos se omitido):
const total = await productRepository.sum("price"); // number | null
const avgPrice = await productRepository.average("price", { active: true });
const cheapest = await productRepository.min("price");
const mostExpensive = await productRepository.max("price");
```

**Campos Decimal** (`Prisma.Decimal`) são totalmente suportados como o `field` de todos esses métodos — o `value` dos métodos atômicos é repassado direto pro Prisma (que aceita `number`, `string`, ou `Decimal`/`DecimalJsLike`), e os métodos de agregação sempre normalizam o resultado pra `number`, nunca uma instância de `Decimal`.

## `createMany`/`createManyReturning`/`updateMany`/`updateManyReturning` não suportam nested writes

`createMany`, `createManyReturning`, `updateMany` e `updateManyReturning` só aceitam campos escalares no `data`. Se seu payload incluir um campo configurado em `relations` (independente do valor), o adapter lança um `VSRepoAdapterError` apontando o campo problemático. Pra um nested write completo, use `create`/`update`/`save` registro por registro, ou envolva várias chamadas de `save` num `saveMany`/`transaction`.

> Nota sobre a ordem de retorno: `createManyReturning` e `updateManyReturning` não garantem que os registros devolvidos seguem a ordem do payload de entrada (`objs`). Sem `select`/`relations` eles são uma única chamada `createManyAndReturn`/`updateManyAndReturn`; com eles, o resultado vem de um segundo `findMany` (re-buscando as linhas inseridas/atualizadas pela primary key, dentro de uma transaction). Em qualquer caso, não conte com a ordem batendo com a da entrada.

## Limitações por provider

Alguns recursos que esse adapter usa não estão disponíveis em todo banco. O adapter checa os dois primeiros abaixo antecipadamente e lança um `VSRepoAdapterError` (code `NOT_SUPPORTED`) antes de tocar no banco; o terceiro fica por conta do Prisma, que lança o próprio erro de validação.

| Recurso | Providers com suporte | Sem suporte |
| --- | --- | --- |
| `ignoreCase` (traduzido pro `mode: "insensitive"` do Prisma; usado pelos métodos dinâmicos `findByXIgnoreCase`) | PostgreSQL, CockroachDB | MySQL, SQLite, SQL Server — MySQL e SQL Server já são case-insensitive por padrão (conforme a collation), então não precisam de `mode`; SQLite só é case-insensitive pra caracteres ASCII |
| `createManyReturning` / `updateManyReturning` (baseados no `createManyAndReturn`/`updateManyAndReturn` do Prisma) | PostgreSQL, CockroachDB, SQLite | MySQL, SQL Server |
| `ignoreConflicts: true` no `createMany` / `createManyReturning` (o `skipDuplicates` do Prisma) | PostgreSQL, MySQL, CockroachDB | SQL Server, SQLite |

O operador `like` não é suportado em nenhum provider — o Prisma não tem equivalente, então o adapter lança `NOT_SUPPORTED`. Use `contains`, `startsWith` ou `endsWith`.

> Essas limitações vêm do próprio Prisma, não do adapter — veja a [doc de case sensitivity](https://www.prisma.io/docs/orm/v7/reference/prisma-client-reference#mode) e a [referência de CRUD](https://www.prisma.io/docs/orm/v7/prisma-client/queries/crud) do Prisma pra mais detalhes. O adapter é coberto por testes de integração em PostgreSQL, MySQL, SQLite, SQL Server e CockroachDB.

## Transactions

**Todos** os métodos aceitam `options.db` e executam a operação no client/transaction passado — a diferença está em **como** cada um o trata:

- A maioria (operações de uma única chamada Prisma) roda direto em `options?.db`: você passa um transaction client e a chamada participa da transaction, sem iniciar nada novo.
- `saveMany` e `deleteManyReturning` — e `updateManyReturning`/`createManyReturning` quando você passa `select` ou `relations` — precisam rodar **mais de uma operação** do Prisma atomicamente (`saveMany` salva cada registro individualmente; `updateManyReturning`/`createManyReturning` fazem um `updateManyAndReturn`/`createManyAndReturn` + `findMany`; `deleteManyReturning` faz um `findMany` + `deleteMany`), então passam por `runTransactional`. Sem `select`/`relations`, `updateManyReturning`/`createManyReturning` são uma única chamada do Prisma. Se `options.db` já for um transaction client ativo, ele é reaproveitado — nenhuma transaction aninhada é criada; caso contrário, uma nova transaction é criada (em `options.db`, se fornecido, ou no client raiz caso contrário).

Um transaction client é diferenciado do `PrismaClient` raiz pelo método `$on`: o client raiz do Prisma o expõe (pra event listeners), o transaction client interativo não. É isso que `Prisma7ClientLike`/`Prisma7OrmTypes` codificam nos seus tipos.

```typescript
await userRepository.transaction(async tx => {
    // Toda chamada de repository feita com `{ db: tx }` dentro desse
    // callback compartilha a mesma transaction — incluindo chamadas a
    // `saveMany`/`updateManyReturning`/`createManyReturning`/`deleteManyReturning`,
    // que vão detectar que `tx` já é uma transaction e rodar direto nele, sem
    // aninhar uma nova.
    await userRepository.save(user, { db: tx });
    await userRepository.save(outrosUsuarios, { db: tx }); // um array salva vários registros
});
```

### Concorrência em `deleteManyReturning`

O `deleteManyReturning` roda um `findMany` no `where` informado (pra capturar os registros que vai devolver) e depois deleta **esses mesmos registros pela primary key** num `deleteMany`, tudo dentro de uma transaction. Como o Prisma não tem um `deleteManyAndReturn` nativo, ele precisa dessas duas etapas. Se o seu `select` deixar a primary key de fora, o adapter a adiciona internamente na query e a remove dos registros devolvidos.

Como o delete é guiado pelas primary keys que de fato foram buscadas, uma linha **inserida depois** do `findMany` nunca é deletada por engano. Ainda assim, uma alteração concorrente entre as duas etapas pode fazer os dois divergirem:

- uma linha devolvida que foi **deletada por outra pessoa** nesse meio-tempo continua sendo devolvida, mesmo não tendo sido deletada por essa chamada;
- uma linha devolvida que **deixa de bater** com o `where` antes do `deleteMany` rodar ainda é deletada, já que o `where` não é re-aplicado.

Se você quiser garantir que não haverá problemas de concorrência, rode esse método **dentro** de um `repository.transaction()` num nível de isolamento mais alto — ex.: `SERIALIZABLE`:

```typescript
import { VSRepoIsolationLevel } from "vsrepo";

await userRepository.transaction(async tx => {
    // Atômico: nenhum insert/update concorrente consegue entrar entre o
    // findMany e o deleteMany, pois o SERIALIZABLE isola esta transaction.
    // Sempre passe `{ db: tx }` pra chamada rodar dentro desta transaction.
    const deleted = await userRepository.deleteManyReturning({ id: { in: [...] } }, { db: tx });
}, {
    isolationLevel: VSRepoIsolationLevel.SERIALIZABLE,
});
```

> O nível de isolamento só se aplica quando a chamada roda **dentro** daquela transaction (ou seja, com `{ db: tx }`). Quando o `deleteManyReturning` inicia a própria transaction interna (sem `options.db`), ele usa o nível de isolamento padrão.

## Logging

O adapter usa o `VSLogger` (de `vsrepo`) internamente: todo método loga uma linha `DEBUG` com o arg resolvido do Prisma, além de logs de performance de início/fim. Configure `logLevel` na config do construtor pra controlar a verbosidade; o default é `VSLogLevel.WARN`.

## Requisitos

- `vsrepo` ^3.0.0-dev.2
- `@prisma/client` ^7.10.0
- Node.js `>=22`
- Um banco PostgreSQL, CockroachDB, MySQL, SQLite ou SQL Server (todos cobertos pelos testes de integração)
