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

> ✅ **Lançado.** Este adapter já foi publicado no npm como `@vsrepo/prisma7-adapter`, feito para o [VSRepository](https://github.com/VSRepository/VSRepository). Por enquanto é o único adapter oficial publicado para a v2 — adapters para outros ORMs estão planejados, mas ainda não foram publicados (veja [Status dos adapters](https://github.com/VSRepository/VSRepository/blob/main/README.pt-BR.md#status-dos-adapters) no README do VSRepository).

Implementação de `VSRepoAdapter` para o [VSRepository v2](https://github.com/VSRepository/VSRepository) usando [Prisma 7](https://www.prisma.io/). Traduz toda operação do `VSRepository` em chamadas do Prisma Client, resolvendo `VSRepoWhere`, `Ordering`, `select`/`relations` através de parsers dedicados e — quando uma config de `relations` é fornecida — resolvendo campos de relação em `create`/`update`/`upsert`/`merge` da mesma forma que a v1 do VSRepository fazia.

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
- [`merge`](#merge)
- [Métodos atômicos e de agregação](#métodos-atômicos-e-de-agregação)
- [`createMany`/`createManyReturning`/`updateMany`/`updateManyReturning` não suportam nested writes](#createmanycreatemanyreturningupdatemanyupdatemanyreturning-não-suportam-nested-writes)
- [Limitações por provider](#limitações-por-provider)
- [Transactions](#transactions)
- [Logging](#logging)
- [Requisitos](#requisitos)

---

## Instalação

```bash
npm install vsrepo @prisma/client @vsrepo/prisma7-adapter
```

Tanto o `vsrepo` quanto o `@vsrepo/prisma7-adapter` já foram publicados no npm e estão prontos para uso.

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
                tableName: "user",
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

const user = await userRepository.get({ id: "..." }, { relations: { posts: true } });
```

Aqui, o `relations` passado no `options` do método — com a forma `{ campo: true }` — é transformado num `include` do Prisma pelo adapter (ver [`relations` nas options (leitura)](#relations-nas-options-leitura)). Se você fornecer `select`, o `relations`/`include` é ignorado. Não confunda com o `relations` da config do construtor (que descreve como campos de relação são resolvidos em escritas) — a diferença é explicada em [Os dois `relations`](#os-dois-relations).

`Prisma7OrmTypes<DB>` amarra os tipos de retorno de `getDbClient()`/`transaction()` do `VSRepository` aos seus tipos reais e gerados do Prisma — ver [Transactions](#transactions).

## Config do construtor

```typescript
new Prisma7Adapter(prisma, {
    tableName: "user", // obrigatório — nome do model/delegate do Prisma Client, como em `prisma.user`
    pkName: "id",       // obrigatório — nome do campo de primary key da entidade
    relations: { ... }, // opcional — ver "relations no construtor (escrita)" abaixo
    logLevel: VSLogLevel.WARN, // opcional — default: VSLogLevel.WARN
});
```

A config é validada na construção — um `tableName`/`pkName`/`relations`/`logLevel` inválido lança um `VSRepoAdapterError` apontando o campo problemático.

## Relations

### Os dois `relations`

O nome `relations` aparece em **dois lugares diferentes** da API, com **formas e propósitos diferentes** — fácil de confundir. Em resumo:

| | `relations` no **construtor** | `relations` nas **options** |
| --- | --- | --- |
| Onde você define | `new Prisma7Adapter(prisma, { relations: ... })` | `repository.get(where, { relations: ... })` — e demais métodos |
| Formato | Um objeto de **configuração** por campo: `{ mode, restriction, pk, nullable? }` | Um objeto por campo **só com `true` ou sub-objeto**: `{ posts: true }` |
| Propósito | **Escrita** — quando um payload de `create`/`update`/`upsert`/`save`/`merge` tem campo de relação, diz como transformá-lo num nested write do Prisma (`create`/`connectOrCreate`/`upsert`/`disconnect`/`deleteMany`/`set`) | **Leitura** — eager loading: quais relations trazer junto no resultado (vira um `include` do Prisma) |
| Quem consome | `parsePrismaWriteData` / `mergeEntities` (resolvers de escrita) | `parsePrismaInclude` (via `resolveReadArg`) |
| Precisa da outra? | Não — só afeta escritas/`merge` | Não — funciona mesmo sem `relations` no construtor |

Nenhum depende do outro: o `relations` das options faz eager loading de leitura mesmo quando o construtor não tem `relations`; e o `relations` do construtor governa o comportamento de escrita mesmo que você nunca passe `relations` nas options. As duas subseções abaixo detalham cada um.

### `relations` no construtor (escrita)

A config `relations` do construtor descreve, para cada campo de relação da entidade, **como o adapter deve resolver esse campo quando ele aparecer nos payloads de escrita** (`create`/`update`/`upsert`/`save`/`merge`) — o mesmo comportamento que a v1 do VSRepository tinha.

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
    { id: "..." },
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

## `merge`

`merge(where, obj, options)` busca o registro que casa com `where` e devolve ele **deep-merged, em memória**, com `obj` — ele **não** escreve nada no banco. Isso reflete exatamente como o `merge` funcionava na v1 do VSRepository: ele serve pra montar uma entidade completa e mesclada, que você depois passa pro `save`/`update`, e não pra persistir um update parcial diretamente.

Pra relations to-many (`otm`/`mtm`), os itens do registro salvo e os itens de `obj` são casados pela `pk` configurada: um match faz merge dos dois itens, uma `pk` nova (ou sem `pk`) é apenas adicionada. `merge` nunca remove nada.

## Métodos atômicos e de agregação

O adapter implementa os 8 métodos abstratos pros quais `increment`/`decrement`/`multiply`/`divide`/`sum`/`average`/`min`/`max` do `VSRepository` delegam: `incrementOne`, `decrementOne`, `multiplyOne`, `divideOne`, `sum`, `average`, `min`, `max`.

- `incrementOne`/`decrementOne`/`multiplyOne`/`divideOne` traduzem direto pra escrita atômica nativa de campo único do Prisma — `data: { [field]: { increment: value } }` (e `decrement`/`multiply`/`divide`) — então a operação é avaliada **server-side** contra o valor *atual* do registro (`UPDATE ... SET field = field + value`), e não como um fetch-then-save no cliente. O `update()` do Prisma já retorna a linha refletindo o estado *após* a escrita, então o adapter nunca precisa fazer uma leitura extra.
- `sum`/`average`/`min`/`max` traduzem pro `aggregate()` do Prisma, com `_sum`/`_avg`/`_min`/`_max: { [field]: true }`. O resultado bruto (`number`, `bigint`, uma instância de `Decimal`, ou `null`) é normalizado pra `number | null` — `null` é repassado como está (espelhando o `SUM()`/`AVG()`/`MIN()`/`MAX()` do SQL, que retornam `NULL`, não `0`, sobre um conjunto vazio), e um valor `Decimal`/`DecimalLike` é convertido via seu `.toNumber()`.

```typescript
// Atômico — avaliado server-side, sem read-modify-write:
await productRepository.increment(productId, "stock", 10);
await accountRepository.decrement(accountId, "balance", 50);
await productRepository.multiply(productId, "price", 1.1); // ex: um reajuste de 10% no preço
await productRepository.divide(productId, "price", 2);

// Agregação — entre todos os registros que casam com um `where` opcional (todos se omitido):
const total = await productRepository.sum("price"); // number | null
const avgPrice = await productRepository.average("price", { active: true });
const cheapest = await productRepository.min("price");
const mostExpensive = await productRepository.max("price");
```

**Campos Decimal** (`Prisma.Decimal`) são totalmente suportados como o `field` dos 8 métodos — o `value` dos métodos atômicos é repassado direto pro Prisma (que aceita `number`, `string`, ou `Decimal`/`DecimalJsLike`), e os métodos de agregação sempre normalizam o resultado pra `number`, nunca uma instância de `Decimal`.

## `createMany`/`createManyReturning`/`updateMany`/`updateManyReturning` não suportam nested writes

`createMany`, `createManyReturning`, `updateMany` e `updateManyReturning` só aceitam campos escalares no `data`. Se seu payload incluir um campo configurado em `relations` (independente do valor), o adapter lança um `VSRepoAdapterError` apontando o campo problemático. Pra um nested write completo, use `create`/`update`/`save` registro por registro, ou envolva várias chamadas de `save` num `saveMany`/`transaction`.

> Nota sobre a ordem de retorno: `createManyReturning` não garante que os registros devolvidos seguem a ordem do payload de entrada (`objs`). O resultado vem de um segundo `findMany` (re-buscando as linhas inseridas/atualizadas pela primary key), então a ordem só é garantida quando você passa `order` nas options.

## Limitações por provider

Alguns recursos do Prisma que esse adapter usa não estão disponíveis em todo banco. Se você usar um desses recursos num provider sem suporte, o próprio Prisma lança um erro de validação (ou, em versões futuras, o adapter pode validar isso antecipadamente — ver abaixo).

| Recurso | Providers com suporte | Sem suporte |
| --- | --- | --- |
| `mode: "insensitive"` (usado pelos métodos dinâmicos `findByXIgnoreCase`) | PostgreSQL, MongoDB | MySQL, SQLite, SQL Server, CockroachDB — MySQL e SQL Server já são case-insensitive por padrão, então não precisam de `mode`; SQLite só é case-insensitive pra caracteres ASCII |
| `createManyReturning` / `updateManyReturning` (baseados no `createManyAndReturn`/`updateManyAndReturn` do Prisma) | PostgreSQL, CockroachDB, SQLite | MySQL, SQL Server, MongoDB |
| `skipDuplicates` no `createManyIgnoreConflicts` / `createManyReturningIgnoreConflicts` | PostgreSQL, MySQL, CockroachDB | MongoDB, SQL Server, SQLite |

> Essas limitações vêm do próprio Prisma, não do adapter — veja a [doc de case sensitivity](https://www.prisma.io/docs/orm/v7/reference/prisma-client-reference#mode) e a [referência de CRUD](https://www.prisma.io/docs/orm/v7/prisma-client/queries/crud) do Prisma pra mais detalhes.

## Transactions

**Todos** os métodos aceitam `options.db` e executam a operação no client/transaction passado — a diferença está em **como** cada um o trata:

- A maioria (operações de uma única chamada Prisma) roda direto em `options?.db`: você passa um transaction client e a chamada participa da transaction, sem iniciar nada novo.
- `saveMany`, `updateManyReturning`, `createManyReturning` e `deleteManyReturning` precisam rodar **mais de uma operação** do Prisma atomicamente (`saveMany` salva cada registro individualmente; `updateManyReturning`/`createManyReturning` fazem um `updateManyAndReturn`/`createManyAndReturn` + `findMany`; `deleteManyReturning` faz um `findMany` + `deleteMany`), então passam por `runTransactional`. Se `options.db` já for um transaction client ativo, ele é reaproveitado — nenhuma transaction aninhada é criada; caso contrário, uma nova transaction é criada (em `options.db`, se fornecido, ou no client raiz caso contrário).

Um transaction client é diferenciado do `PrismaClient` raiz pelo método `$on`: o client raiz do Prisma o expõe (pra event listeners), o transaction client interativo não. É isso que `Prisma7ClientLike`/`Prisma7OrmTypes` codificam nos seus tipos.

```typescript
await userRepository.transaction(async tx => {
    // Toda chamada de repository feita com `{ db: tx }` dentro desse
    // callback compartilha a mesma transaction — incluindo chamadas a
    // `saveMany`/`updateManyReturning`/`createManyReturning`/`deleteManyReturning`,
    // que vão detectar que `tx` já é uma transaction e rodar direto nele, sem
    // aninhar uma nova.
    await userRepository.save(user, { db: tx });
    await userRepository.saveList(outrosUsuarios, { db: tx });
});
```

### Concorrência em `deleteManyReturning`

O `deleteManyReturning` roda um `findMany` no `where` informado (pra capturar os registros que vai devolver) e depois **re-aplica o mesmo `where`** num `deleteMany`. Como o Prisma não tem um `deleteManyAndReturn` nativo, o delete é guiado pelo `where` — e não pelos registros retornados no `findMany`.

Por causa desse formato em duas etapas, uma alteração concorrente entre o `findMany` e o `deleteMany` pode fazer os dois divergirem:

- uma linha **inserida depois** do `findMany` que bate com o `where` ainda será deletada, mesmo não tendo sido retornada;
- uma linha que **deixa de bater** com o `where` antes do `deleteMany` rodar não será deletada, mesmo tendo sido retornada.

Ou seja: os registros retornados e as linhas realmente deletadas não têm garantia de serem idênticos sob concorrência.

Se você quiser garantir que não haverá problemas de concorrência, rode esse método **dentro** de um `repository.transaction()` num nível de isolamento mais alto — ex.: `SERIALIZABLE`:

```typescript
import { VSRepository, TransactionIsolationLevel } from "vsrepo";

await userRepository.transaction(async tx => {
    // Atômico: nenhum insert/update concorrente consegue entrar entre o
    // findMany e o deleteMany, pois o SERIALIZABLE isola esta transaction.
    // O `deleteManyReturning` é acessado através do método dinâmico que você
    // mapeou pro adapter (ex.: um `@DynamicMethod()` expondo `deleteManyReturning`),
    // sempre passando `{ db: tx }` pra rodar dentro desta transaction.
    const deleted = await userRepository.deleteManyReturningByIdIn([...], { db: tx });
}, {
    isolationLevel: TransactionIsolationLevel.SERIALIZABLE,
});
```

> O nível de isolamento só se aplica quando a chamada roda **dentro** daquela transaction (ou seja, com `{ db: tx }`). Quando o `deleteManyReturning` inicia a própria transaction interna (sem `options.db`), ele usa o nível de isolamento padrão.

## Logging

O adapter usa o `VSLogger` (de `vsrepo`) internamente: todo método loga uma linha `DEBUG` com o arg resolvido do Prisma, além de logs de performance de início/fim (com `WARN` pra operações lentas). Configure `logLevel` na config do construtor pra controlar a verbosidade; o default é `VSLogLevel.WARN`.

## Requisitos

- `vsrepo` ^2.7.2
- `@prisma/client` ^7.10.0
