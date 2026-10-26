# Changelog

All notable changes to this project will be documented in this file.

(Português) Todas as mudanças notáveis neste projeto serão documentadas neste arquivo.

---

## [1.3.2] - 2026-09-30

### Fixed
-  **`mode: "insensitive"` is now always applied when `ignoreCase` is `true`** – prior to this fix, `mode: "insensitive"` was only applied to fields within a specific list; it did not cover the `in` and `notIn` fields, nor others that also support case-insensitivity
- **`is` and `isNot` can now be applied together** – prior to this fix, *parseObjectRelationFilter* applied only one or the other, potentially silently ignoring user filters

---

## [1.3.2] - 2026-09-30 (Português)

### Corrigido
- **`mode: "insensitive"` agora é sempre aplicado quando `ignoreCase` for `true`** - antes desse fix o `mode: "insensitive"` só era aplicado em campos dentro de uma lista específica, porém não cobria os campos `in` e `notIn`, e outros que também podem aceitar o insensitive
- **`is` e `isNot` agora podem ser aplicados juntos** - antes desse fix o *parseObjectRelationFilter* só aplicava um ou outro, podendo silenciosamente ignorar filtros do usuário

---

## [1.3.1] - 2026-09-29

### Fixed
- **`saveMany` no longer runs the individual `save` calls in parallel inside the transaction** — previously, all records were dispatched at once with `Promise.all(objs.map(...))` against the same transaction client, but a Prisma/pg transaction client cannot execute concurrent queries: it emitted `DeprecationWarning: Calling client.query() when the client is already executing a query is deprecated and will be removed in pg@9.0. Use async/await or an external async flow control mechanism instead.` and would break outright on `pg@9`. Records are now saved sequentially (`await` inside a `for` loop), still inside the same transaction, reusing an active `options.db` transaction client when one is given

### Changed
- `vsrepo` peer dependency bumped to `^2.7.2`

---

## [1.3.1] - 2026-09-29 (Português)

### Corrigido
- **`saveMany` não executa mais os `save` individuais em paralelo dentro da transação** — anteriormente, todos os registros eram disparados de uma vez com `Promise.all(objs.map(...))` contra o mesmo transaction client, mas um transaction client do Prisma/pg não pode executar queries concorrentes: ele emitia `DeprecationWarning: Calling client.query() when the client is already executing a query is deprecated and will be removed in pg@9.0. Use async/await or an external async flow control mechanism instead.` e passaria a quebrar de vez no `pg@9`. Agora os registros são salvos sequencialmente (`await` dentro de um `for`), ainda dentro da mesma transação, reaproveitando um transaction client já ativo em `options.db` quando fornecido

### Alterado
- Peer dependency `vsrepo` elevada pra `^2.7.2`

---

## [1.3.0] - 2026-09-26

### Added
- **Provider detection** — detection order: the new `provider` constructor option (overrides) → the generated client's `_engineConfig.activeProvider` → the driver adapter's `provider`. Never throws, even when nothing can be detected
- **`getPlaceholder(index)`** — implements the new optional `VSRepoAdapter.getPlaceholder?` method released with `vsrepo` 2.7.0: returns the raw-query placeholder syntax for the `index`-th (0-based) bound parameter (`$${index + 1}` for `postgresql`/`cockroachdb`, `?` for `mysql`/`sqlite`, `@P${index + 1}` for `sqlserver`). This is what enables `VSSql` fragments and `vsPlaceholders` in `VSRepository`. When the provider can't be resolved, it throws a `VSRepoAdapterError` (code `NOT_SUPPORTED`) only when actually called — never at construction

### Changed
- New optional `provider` field in the constructor config, validated at construction time against the provider picklist
- `vsrepo` peer dependency bumped to `^2.7.0`

---

## [1.3.0] - 2026-09-26 (Português)

### Adicionado
- **Detecção de provider** — ordem de detecção: a nova opção `provider` do construtor (sobrescreve) → o `_engineConfig.activeProvider` do client gerado → o `provider` do driver adapter. Nunca lança, mesmo quando nada é detectável
- **`getPlaceholder(index)`** — implementa o novo método opcional `VSRepoAdapter.getPlaceholder?` lançado junto com a `vsrepo` 2.7.0: retorna a sintaxe de placeholder de query raw pro N-ésimo (base 0) parâmetro ligado (`$${index + 1}` pra `postgresql`/`cockroachdb`, `?` pra `mysql`/`sqlite`, `@P${index + 1}` pra `sqlserver`). É o que habilita os fragmentos `VSSql` e o `vsPlaceholders` no `VSRepository`. Quando o provider não é resolvível, lança um `VSRepoAdapterError` (code `NOT_SUPPORTED`) somente quando é de fato chamado — nunca na construção

### Alterado
- Nova opção opcional `provider` na config do construtor, validada na construção contra o picklist de providers
- Peer dependency `vsrepo` elevada pra `^2.7.0`

---

## [1.2.0] - 2026-09-19

### Added
- `VSRepoPrisma7Adapter` now implements the new optional `getPkName()` adapter method
- Now `logSlowThresholdMs` accepts a `number` (ms) **or** a `boolean` — `false` disables slow-operation warnings entirely, `true`/omitted falls back to the default `300`ms

### Changed
- `vsrepo` peer dependency bumped to `^2.5.0`

---

## [1.2.0] - 2026-09-19 (Português)

### Adicionado
- `VSRepoPrisma7Adapter` agora implementa o novo método opcional `getPkName()` dos adapters
- Agora `logSlowThresholdMs` aceita um `number` (ms) **ou** um `boolean` — `false` desativa os warnings de operação lenta por completo, `true`/omitido cai pro default de `300`ms

### Alterado
- Peer dependency `vsrepo` elevada pra `^2.5.0`

---

## [1.1.6] - 2026-09-16

### Added
- **`PrismaClientModels` type is now exported from the package index** — it is now part of the public API surface with full JSDoc, making it easier to reference the model delegate map type directly from userland
- **Improved `VSRepoPrisma7AdapterConfig` typings for better auto-complete** — the config type now provides more precise generic constraints, improving IDE auto-complete and type inference when instantiating the adapter

### Changed
- **Removed `valibot` runtime dependency — constructor validation is now done manually** — `valibot` has been removed from `dependencies`; all constructor config validation (previously delegated to valibot schemas) is now performed through hand-written checks in `validate-adapter-config.validator.ts`. This eliminates an external runtime dependency without any change to the validation behavior or error surface (`VSRepoAdapterError` codes remain the same)

---

## [1.1.6] - 2026-09-16 (Português)

### Adicionado
- **O tipo `PrismaClientModels` agora é exportado pelo index do pacote** — agora faz parte da API pública com JSDoc completa, facilitando o uso direto do tipo de mapa de delegates do Prisma no código do usuário
- **Tipagem do `VSRepoPrisma7AdapterConfig` melhorada para facilitar o auto-complete** — o tipo de config agora possui restrições genéricas mais precisas, melhorando o auto-complete da IDE e a inferência de tipos ao instanciar o adapter

### Alterado
- **Removida a dependência runtime `valibot` — validações do construtor agora são feitas manualmente** — o `valibot` foi removido das `dependencies`; toda a validação da config do construtor (antes delegada aos schemas do valibot) agora é feita por verificações escritas à mão em `validate-adapter-config.validator.ts`. Isso elimina uma dependência externa de runtime sem nenhuma mudança no comportamento de validação ou na superfície de erros (os códigos de `VSRepoAdapterError` permanecem os mesmos)

---

## [1.1.5] - 2026-09-14

### Added
- **`nullable` support for `oto` (one-to-one) relations** — `nullable: true` is now permitted and validated for `oto` relations (previously restricted to `mto`), allowing optional one-to-one relationships to be configured

### Fixed
- **Robust `null` handling and validation in to-one relations (`oto` / `mto`)**:
  - Providing `null` for a to-one relation when `nullable` is omitted or `false` now explicitly throws a `VSRepoAdapterError` (code `INVALID_DATA`), preventing silent unexpected behaviors or unintended deletions
  - When `nullable: true`:
    - For `oto` with `restriction: "set"`, passing `null` resolves to `{ delete: true }` on update (the owned row is removed)
    - For `oto` with `restriction: "add"` or `mto`, passing `null` resolves to `{ disconnect: true }` on update
  - In `parseToOneRelation`, primary key existence is now checked against `undefined` (`pkValue == undefined`) instead of `null`, preventing false positives when evaluating the relation payload's identifier

---

## [1.1.5] - 2026-09-14 (Português)

### Adicionado
- **Suporte a `nullable` para relações `oto` (one-to-one)** — a opção `nullable: true` agora é permitida e validada também para relações `oto` (anteriormente restrita a `mto`), possibilitando a configuração de relações um-para-um opcionais

### Corrigido
- **Tratamento e validação robusta de `null` em relações to-one (`oto` / `mto`)**:
  - Enviar `null` para uma relação to-one quando `nullable` estiver ausente ou `false` agora lança explicitamente um `VSRepoAdapterError` (código `INVALID_DATA`), evitando comportamentos inesperados ou deleções não intencionais
  - Quando `nullable: true`:
    - Para `oto` com `restriction: "set"`, passar `null` resolve para `{ delete: true }` no update (a linha dependente é removida)
    - Para `oto` com `restriction: "add"` ou `mto`, passar `null` resolve para `{ disconnect: true }` no update
  - No `parseToOneRelation`, a verificação da presença de chave primária agora compara com `undefined` (`pkValue == undefined`) em vez de `null`, prevenindo falsos positivos na avaliação do identificador do payload da relação

---

## [1.1.4] - 2026-09-12

### Added
- **The `Prisma7OrmTypes` utility type now only requires the `PrismaClient` type to infer ORM types** – previously, it required both `PrismaClient` and `Prisma.TransactionClient` types; now, the transaction type is inferred from the `PrismaClient`'s `$transaction` method
- **New alias `Prisma7Adapter` for `VSRepoPrisma7Adapter`** - `VSRepoPrisma7Adapter` can now *also* be imported as `Prisma7Adapter`

### Performance
- **The payload calculation for `to-many` relations now only calculates the `upsert` for `one-to-many` relations** – previously, the `upsert` was also calculated for `many-to-many` relations but was not used.

---

## [1.1.4] - 2026-09-12 (Português)

### Adicionado
- **O tipo utilitário `Prisma7OrmTypes` agora só precisa da tipagem do PrismaClient para inferir as tipagens do ORM** - antes precisava da tipagem do PrismaClient e do Prisma.TransactionClient, agora o tipo da transaction é inferido pelo método `$transaction` do PrismaClient
- **Novo alias `Prisma7Adapter` para o `VSRepoPrisma7Adapter`** - agora o `VSRepoPrisma7Adapter` *também* pode ser importado como `Prisma7Adapter`

### Desempenho
- **Agora o cálculo do payload de relações `to-many` só calcula o `upsert` para relações `one-to-many`** - antes o `upsert` era calculado pro `many-to-many` também, mas não era utilizado

---

## [1.1.3] - 2026-09-10

### Fixed
- **`runInTransaction` now correctly forwards the `timeoutMs` option to Prisma** — previously, the method passed the whole options object straight to `$transaction`, which only recognizes `isolationLevel`/`maxWait`/`timeout`, so a `timeoutMs` passed through `VSRepository.transaction()` — documented as an adapter option — never reached Prisma. The signature now types options as `VSRepoTransactionOptions` and explicitly maps `timeoutMs` to Prisma's `timeout` (alongside `isolationLevel`), so interactive transactions actually respect the configured timeout

---

## [1.1.3] - 2026-09-10 (Português)

### Corrigido
- **`runInTransaction` agora repassa corretamente a opção `timeoutMs` pro Prisma** — anteriormente, o método passava o objeto de options inteiro direto pro `$transaction`, que só reconhece `isolationLevel`/`maxWait`/`timeout`, então um `timeoutMs` passado via `VSRepository.transaction()` — documentado como opção do adapter — nunca chegava no Prisma. A assinatura agora tipa as options como `VSRepoTransactionOptions` e mapeia explicitamente `timeoutMs` pro `timeout` do Prisma (junto do `isolationLevel`), fazendo as transactions interativas respeitarem de fato o timeout configurado

---

## [1.1.2] - 2026-09-09

### Fixed
- **`count` now correctly passes `readArg` (pagination, order, select, relations, distinct) to Prisma** — previously, `count` only forwarded `{ where }`, silently ignoring any `pagination` or `order` options passed through `AdapterMethodOptions`. The method now calls `resolveReadArg(options)` and spreads the result into the Prisma arg, enabling pagination (`offset`/`limit`) and ordering to work as expected with `count`

---

## [1.1.2] - 2026-09-09 (Português)

### Corrigido
- **`count` agora repassa corretamente o `readArg` (pagination, order, select, relations, distinct) pro Prisma** — anteriormente, o `count` só encaminhava `{ where }`, ignorando silenciosamente quaisquer opções de `pagination` ou `order` passadas via `AdapterMethodOptions`. O método agora chama `resolveReadArg(options)` e espalha o resultado no arg do Prisma, habilitando paginação (`offset`/`limit`) e ordenação no `count`

---

## [1.1.1] - 2026-09-07

### Added
- **Stronger constructor validation**, catching more misconfigurations at construction time instead of on the first query:
  - The Prisma client (first constructor argument) is now validated: passing `null`/`undefined` throws a `VSRepoAdapterError` (code `MISSING_DB_CLIENT`) immediately, instead of failing later with a raw `Cannot read properties of undefined`
  - `tableName` is now checked against the provided Prisma client: if `prisma[tableName]` doesn't exist as a delegate (e.g. a typo, or a model name that doesn't exist in the generated client), the constructor throws a `VSRepoAdapterError` (code `MODEL_NOT_FOUND`) naming the missing delegate, instead of failing on the first `save`/`get`/etc.
  - `relations[field].nullable: true` is now rejected when `mode` is not `mto` — `nullable` only applies to `mto`. Validated with a new `VSRepoAdapterError` (code `INVALID_ADAPTER_CONFIG`), same as the rest of the relation schema
- New `validators/validate-prisma-client.validator.ts`, plus tests covering all three new validations (`tests/config-validation.test.ts`)

---

## [1.1.1] - 2026-09-07 (Português)

### Adicionado
- **Validação mais forte no construtor**, pegando mais erros de configuração já na construção em vez de na primeira query:
  - O client Prisma (primeiro argumento do construtor) agora é validado: passar `null`/`undefined` lança um `VSRepoAdapterError` (code `MISSING_DB_CLIENT`) imediatamente, em vez de falhar depois com um `Cannot read properties of undefined` genérico
  - `tableName` agora é conferido contra o client Prisma fornecido: se `prisma[tableName]` não existir como delegate (ex.: um typo, ou um nome de model que não existe no client gerado), o construtor lança um `VSRepoAdapterError` (code `MODEL_NOT_FOUND`) nomeando o delegate ausente, em vez de falhar no primeiro `save`/`get`/etc.
  - `relations[campo].nullable: true` agora é rejeitado quando `mode` é diferente de `mto` — `nullable` só se aplica a `mto`. Validado com um novo `VSRepoAdapterError` (code `INVALID_ADAPTER_CONFIG`), igual ao resto do schema de relation
- Novo `validators/validate-prisma-client.validator.ts`, além de testes cobrindo as três novas validações (`tests/config-validation.test.ts`)

---

## [1.1.0] - 2026-09-04

### Added
- **Atomic and aggregation methods** — implements the 8 new abstract methods added to the `VSRepoAdapter` contract by `vsrepo` 2.1.0: `incrementOne`, `decrementOne`, `multiplyOne`, `divideOne`, `sum`, `average`, `min` and `max`
  - `incrementOne`/`decrementOne`/`multiplyOne`/`divideOne` translate directly into Prisma's native single-field atomic write (`data: { [field]: { increment: value } }`, etc.), evaluated server-side against the row's *current* value, not as a client-side read-modify-write. Prisma's `update()` already returns the row reflecting the state *after* the write, so no follow-up read is issued
  - `sum`/`average`/`min`/`max` translate into Prisma's `aggregate()` (`_sum`/`_avg`/`_min`/`_max`); the raw result (`number`, `bigint`, `Decimal`, or `null`) is normalized to `number | null`, returning `null` (not `0`) when no record matches, mirroring SQL's `SUM()`/`AVG()`/`MIN()`/`MAX()`
  - `Decimal` fields are fully supported: atomic `value`s are passed through to Prisma as-is, and aggregate results are always normalized to `number` via `.toNumber()`, never returned as a `Decimal` instance
  - New "Atomic and aggregation methods" section in `README.md`/`README.pt-BR.md`, plus JSDoc on every new method

### Changed
- **BREAKING (peer dependency):** the `vsrepo` peer dependency was bumped from `^2.0.0` to `^2.1.0` — the adapter now imports `NumericKeys`/`DecimalLike` types that only exist starting in `vsrepo` 2.1.0, and implements the new abstract methods required by that version's `VSRepoAdapter` contract

---

## [1.1.0] - 2026-09-04 (Português)

### Adicionado
- **Métodos atômicos e de agregação** — implementa os 8 novos métodos abstratos adicionados ao contrato do `VSRepoAdapter` pela `vsrepo` 2.1.0: `incrementOne`, `decrementOne`, `multiplyOne`, `divideOne`, `sum`, `average`, `min` e `max`
  - `incrementOne`/`decrementOne`/`multiplyOne`/`divideOne` traduzem direto pra escrita atômica nativa de campo único do Prisma (`data: { [field]: { increment: value } }`, etc.), avaliada server-side contra o valor *atual* do registro, e não como um read-modify-write no cliente. O `update()` do Prisma já retorna a linha refletindo o estado *após* a escrita, então nenhuma leitura extra é feita
  - `sum`/`average`/`min`/`max` traduzem pro `aggregate()` do Prisma (`_sum`/`_avg`/`_min`/`_max`); o resultado bruto (`number`, `bigint`, `Decimal`, ou `null`) é normalizado pra `number | null`, retornando `null` (não `0`) quando nenhum registro casa, espelhando o `SUM()`/`AVG()`/`MIN()`/`MAX()` do SQL
  - Campos `Decimal` são totalmente suportados: os `value`s atômicos são repassados pro Prisma como estão, e os resultados de agregação são sempre normalizados pra `number` via `.toNumber()`, nunca retornados como uma instância de `Decimal`
  - Nova seção "Métodos atômicos e de agregação" no `README.md`/`README.pt-BR.md`, além de JSDoc em cada novo método

### Alterado
- **BREAKING (peer dependency):** a peer dependency `vsrepo` foi elevada de `^2.0.0` pra `^2.1.0` — o adapter agora importa os tipos `NumericKeys`/`DecimalLike`, que só existem a partir da `vsrepo` 2.1.0, e implementa os novos métodos abstratos exigidos pelo contrato `VSRepoAdapter` dessa versão

---

## [1.0.3] - 2026-09-03

### Fixed
- `logSlowThresholdMs` option was missing from the runtime validation schema (`adapterConfigSchema`) — although the option was documented and consumed in the constructor since v1.0.1, it was not declared in the valibot schema, which could cause validation issues; the field is now properly validated as an optional positive number, and a default value of `300` is applied before passing it to `VSLogger`

---

## [1.0.3] - 2026-09-03 (Português)

### Corrigido
- A opção `logSlowThresholdMs` estava faltando no schema de validação em runtime (`adapterConfigSchema`) — embora a opção fosse documentada e consumida no construtor desde a v1.0.1, ela não estava declarada no schema valibot, o que poderia causar problemas de validação; o campo agora é validado corretamente como um número positivo opcional, e um valor padrão de `300` é aplicado antes de passá-lo ao `VSLogger`

---

## [1.0.2] - 2026-09-02

### Docs
- Documented how `deleteManyReturning` works — it fetches the records matching `where` via a `findMany` and then **re-applies the same `where`** to a `deleteMany` (Prisma has no native `deleteManyAndReturn`). Because the delete is driven by the `where` rather than the fetched records, a concurrent change between the two operations can make the returned records and the actually-deleted rows diverge (e.g. a row inserted after the `findMany` still gets deleted even though it wasn't returned; a row that stops matching before the `deleteMany` isn't deleted even though it was returned). Added guidance in the `README.md`/`README.pt-BR.md` (Transactions section) on running the method inside a `repository.transaction()` at a higher isolation level (e.g. `TransactionIsolationLevel.SERIALIZABLE`) to guarantee no concurrency issues, and updated the JSDoc of `deleteManyReturning` accordingly

---

## [1.0.2] - 2026-09-02 (Português)

### Documentação
- Documentado o funcionamento do `deleteManyReturning` — ele busca os registros que batem com o `where` via um `findMany` e depois **re-aplica o mesmo `where`** num `deleteMany` (o Prisma não tem um `deleteManyAndReturn` nativo). Como o delete é guiado pelo `where` — e não pelos registros buscados — uma alteração concorrente entre as duas operações pode fazer os registros retornados e as linhas realmente deletadas divergirem (ex.: uma linha inserida depois do `findMany` ainda é deletada mesmo sem ter sido retornada; uma linha que deixa de bater antes do `deleteMany` não é deletada mesmo tendo sido retornada). Adicionada orientação no `README.md`/`README.pt-BR.md` (seção Transactions) para rodar o método dentro de um `repository.transaction()` num nível de isolamento mais alto (ex.: `TransactionIsolationLevel.SERIALIZABLE`) para garantir que não haverá problemas de concorrência, e atualizado o JSDoc do `deleteManyReturning` de acordo

---

## [1.0.1] - 2026-09-02

### Fixed
- `merge` method now strips `undefined` fields from the source object before merging — previously, when merging entities without `relations` (`relations` config absent), `undefined` values from the source object were carried into the result, which could overwrite existing fields of the stored record with `undefined`
- Corrected the performance log texts — the start/end logs now read `run <method>` (e.g. `run findOne`) consistently across every method instead of the method name alone

### Added
- Documented provider-specific limitations in `README.md`/`README.pt-BR.md` — a table covering which Prisma features this adapter relies on aren't available on every provider (`mode: "insensitive"` for case-insensitive filters, `createManyReturning`/`updateManyReturning` for returning writes, and `skipDuplicates` on the `IgnoreConflicts` variants), noting these come from Prisma itself, not from the adapter
- Added a new `logSlowThresholdMs` option to the `VSRepoPrisma7Adapter` constructor config — the duration (in ms) above which a finished operation is logged as potentially slow, passed through to the internal `VSLogger`; defaults to `300ms`, complementing the existing `logLevel` option for performance monitoring

---

## [1.0.1] - 2026-09-02 (Português)

### Corrigido
- O método `merge` agora remove campos com valor `undefined` do objeto de origem antes de mesclar — antes, ao mesclar entidades sem `relations` (config de `relations` ausente), valores `undefined` do objeto de origem eram propagados para o resultado, o que poderia sobrescrever campos existentes do registro salvo com `undefined`
- Corrigidos os textos dos logs de performance — os logs de início/fim agora leem `run <método>` (ex.: `run findOne`) de forma consistente em todos os métodos, em vez de apenas o nome do método

### Adicionado
- Documentadas as limitações por provider no `README.md`/`README.pt-BR.md` — uma tabela cobrindo quais recursos do Prisma que esse adapter usa não estão disponíveis em todos os bancos (`mode: "insensitive"` para filtros case-insensitive, `createManyReturning`/`updateManyReturning` para escritas com retorno, e `skipDuplicates` nas variantes `IgnoreConflicts`), destacando que essas limitações vêm do próprio Prisma, não do adapter
- Adicionada uma nova opção `logSlowThresholdMs` na config do construtor do `VSRepoPrisma7Adapter` — a duração (em ms) acima da qual uma operação finalizada é logada como potencialmente lenta, repassada ao `VSLogger` interno; o default é `300ms`, complementando a opção `logLevel` já existente para monitoramento de performance

---

## [1.0.0] - 2026-08-31

> First official release. `@vsrepo/prisma7-adapter` is the officially published `VSRepoAdapter` implementation for [VSRepository v2](https://github.com/VSRepository/VSRepository), backed by [Prisma 7](https://www.prisma.io/).

### Added
- **Full `VSRepoAdapter` implementation** — translates every `VSRepository` operation into Prisma Client calls, backed by Prisma 7
- **Where/ordering parsing** — resolves `VSRepoWhere`, `Ordering` and case-insensitive filters (`IgnoreCase`) through dedicated parsers (`parsePrismaWhere`)
- **`select` support** — transforms method-options `select` into a Prisma `select` in read operations (`parsePrismaSelect`)
- **`relations` in method options (read)** — eager loading shape `{ field: true }` / `{ field: { sub: true } }` (nested) transformed into a Prisma `include` (`parsePrismaInclude`); the `include` is discarded when a `select` is provided (Prisma doesn't combine `include` and `select`)
- **`relations` in the constructor (write)** — describes each relation field (`mode: "oto" | "mto" | "otm" | "mtm"`, `restriction: "add" | "set"`, `pk`, `nullable`) so `create`/`update`/`upsert`/`save`/`merge` payload relation fields are resolved into Prisma nested writes (`create`/`connectOrCreate`/`upsert`/`disconnect`/`delete`/`deleteMany`/`set`) — the same behavior the v1 of VSRepository had
- **Full base method support** — `findOne`, `findOneOrThrow`, `findMany`, `save` (create/upsert), `saveMany`, `delete`, `deleteMany`, `deleteManyReturning`, `update`, `updateMany`, `updateManyReturning`, `count`, `exists`, `create`, `createMany`, `createManyReturning`, `merge`, `upsert`
- **`createManyReturning` / `updateManyReturning` / `deleteManyReturning`** — returning writes built on Prisma's `createManyAndReturn`/`updateManyAndReturn`, re-querying the affected rows by primary key via a second `findMany`, with `select`/`include` support and respect for the `order` option
- **Error mapping** — every Prisma/ORM error is mapped and always re-thrown as `VSRepoAdapterError`, carrying the original ORM error and a dedicated `AdapterErrorCode`
- **Config validation** — the constructor config (`tableName`, `pkName`, `relations`, `logLevel`) is validated at runtime with [valibot](https://valibot.dev/); an invalid value throws a `VSRepoPrisma7AdapterError` naming the offending field
- **Transactions** — every method accepts `options.db`; multi-operation methods (`saveMany`, `updateManyReturning`, `createManyReturning`, `deleteManyReturning`) go through `runTransactional`, reusing an already-active transaction client (detected by the `$on` method) instead of nesting a new one
- **`Prisma7OrmTypes<DB, TX>` / `Prisma7ClientLike`** — type helpers that tie `VSRepository`'s `getDbClient()`/`transaction()` return types to your real, generated Prisma types
- **Logging** — uses `VSLogger` internally: a `DEBUG` line with the resolved Prisma arg per method plus start/end performance logs (WARN on slow operations), controlled by the `logLevel` constructor option
- **Nested-write validation** — `createMany`/`createManyReturning`/`updateMany`/`updateManyReturning` only accept scalar fields; a payload containing a configured relation field throws a `VSRepoPrisma7AdapterError`
- **Build & pack** — `tsc` build to `dist/`, npm `prepack` build, `clean`/`build`/`typecheck` scripts, and `files` whitelisting for publishing (commonly CommonJS output)
- **CI workflow** — GitHub Actions (`.github/workflows/ci.yml`)
- **Tests** — implementation tests for the adapter and integration tests with `VSRepository` (including dynamic and query methods), plus `example.ts` usage example
- **Documentation** — `README.md`/`README.pt-BR.md` (English + Portuguese) covering installation, basic usage, the constructor config, the two `relations` (`write` vs `read`), `merge`, transactions, logging, requirements, and full JSDoc on the public API surface (marked `@publicApi`), plus a downloads badge

---

## [1.0.0] - 2026-08-31 (Português)

> Primeira release oficial. `@vsrepo/prisma7-adapter` é a implementação oficial publicada de `VSRepoAdapter` para o [VSRepository v2](https://github.com/VSRepository/VSRepository), usando [Prisma 7](https://www.prisma.io/).

### Adicionado
- **Implementação completa de `VSRepoAdapter`** — traduz toda operação do `VSRepository` em chamadas do Prisma Client, usando Prisma 7
- **Parsing de where/ordering** — resolve `VSRepoWhere`, `Ordering` e filtros case-insensitive (`IgnoreCase`) através de parsers dedicados (`parsePrismaWhere`)
- **Suporte a `select`** — transforma o `select` das options dos métodos num `select` do Prisma nas operações de leitura (`parsePrismaSelect`)
- **`relations` nas options (leitura)** — eager loading com a forma `{ campo: true }` / `{ campo: { sub: true } }` (aninhado) transformado num `include` do Prisma (`parsePrismaInclude`); o `include` é descartado quando um `select` é fornecido (o Prisma não combina `include` e `select`)
- **`relations` no construtor (escrita)** — descreve cada campo de relação (`mode: "oto" | "mto" | "otm" | "mtm"`, `restriction: "add" | "set"`, `pk`, `nullable`) para que os campos de relação dos payloads de `create`/`update`/`upsert`/`save`/`merge` sejam resolvidos em nested writes do Prisma (`create`/`connectOrCreate`/`upsert`/`disconnect`/`delete`/`deleteMany`/`set`) — o mesmo comportamento que a v1 do VSRepository tinha
- **Suporte completo aos métodos base** — `findOne`, `findOneOrThrow`, `findMany`, `save` (create/upsert), `saveMany`, `delete`, `deleteMany`, `deleteManyReturning`, `update`, `updateMany`, `updateManyReturning`, `count`, `exists`, `create`, `createMany`, `createManyReturning`, `merge`, `upsert`
- **`createManyReturning` / `updateManyReturning` / `deleteManyReturning`** — escritas com retorno baseadas nos `createManyAndReturn`/`updateManyAndReturn` do Prisma, re-buscando as linhas afetadas pela primary key num segundo `findMany`, com suporte a `select`/`include` e respeito à opção `order`
- **Mapeamento de erros** — todo erro de Prisma/ORM é mapeado e sempre relançado como `VSRepoAdapterError`, carregando o erro original do ORM e um `AdapterErrorCode` dedicado
- **Validação de config** — a config do construtor (`tableName`, `pkName`, `relations`, `logLevel`) é validada em runtime com [valibot](https://valibot.dev/); um valor inválido lança um `VSRepoPrisma7AdapterError` apontando o campo problemático
- **Transactions** — todos os métodos aceitam `options.db`; métodos com múltiplas operações (`saveMany`, `updateManyReturning`, `createManyReturning`, `deleteManyReturning`) passam por `runTransactional`, reaproveitando um transaction client já ativo (detectado pelo método `$on`) em vez de aninhar uma nova
- **`Prisma7OrmTypes<DB, TX>` / `Prisma7ClientLike`** — helpers de tipo que amarram os tipos de retorno de `getDbClient()`/`transaction()` do `VSRepository` aos seus tipos reais e gerados do Prisma
- **Logging** — usa o `VSLogger` internamente: uma linha `DEBUG` com o arg resolvido do Prisma por método e logs de performance de início/fim (WARN pra operações lentas), controlado pela opção `logLevel` do construtor
- **Validação de nested writes** — `createMany`/`createManyReturning`/`updateMany`/`updateManyReturning` só aceitam campos escalares; um payload contendo um campo de relação configurado lança um `VSRepoPrisma7AdapterError`
- **Build & pack** — build com `tsc` para `dist/`, `prepack` de build no npm, scripts `clean`/`build`/`typecheck`, e whitelist de `files` para publicação (saída CommonJS)
- **Workflow de CI** — GitHub Actions (`.github/workflows/ci.yml`)
- **Testes** — testes de implementação para o adapter e testes de integração com o `VSRepository` (incluindo dynamic e query methods), além do exemplo de uso `example.ts`
- **Documentação** — `README.md`/`README.pt-BR.md` (inglês + português) cobrindo instalação, uso básico, config do construtor, os dois `relations` (escrita vs leitura), `merge`, transactions, logging, requisitos e JSDoc completa na API pública (marcada com `@publicApi`), além do badge de downloads

---
