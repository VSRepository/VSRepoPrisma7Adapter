/**
 * Parser que converte um `Ordering<T>` (formato "amigável" do vsrepo) num
 * `orderBy` válido de qualquer modelo do Prisma.
 *
 * Suporta:
 *  - Direção em qualquer caixa:  { name: "ASC" } / { name: "asc" } -> { name: "asc" }
 *  - Ordenação encadeada:        [{ name: "asc" }, { createdAt: "desc" }]
 *  - Ordenação aninhada em relations to-one: { address: { city: "asc" } }
 */

import { Ordering, SortDirection } from "vsrepo";
import { PlainObject } from "../types/plain-object.type.js";
import { isPlainObject } from "../validators/is-plain-object.validator.js";

function isSortDirection(value: unknown): value is SortDirection {
    return value === "asc" || value === "desc" || value === "ASC" || value === "DESC";
}

function parseOrderByField(order: PlainObject): PlainObject {
    const result: PlainObject = {};

    for (const [key, value] of Object.entries(order)) {
        if (value === undefined) continue;

        result[key] = isSortDirection(value)
            ? value.toLowerCase()
            : isPlainObject(value)
              ? parseOrderByField(value)
              : value;
    }

    return result;
}

/**
 * Use o segundo generic para tipar o retorno com o `OrderByInput`
 * do Prisma correspondente ao modelo.
 */
export function parsePrismaOrderBy<T>(order: Ordering<T> | undefined): PlainObject | PlainObject[] | undefined {
    if (!order) return;

    return Array.isArray(order) ? order.map(o => parseOrderByField(o)) : parseOrderByField(order);
}
