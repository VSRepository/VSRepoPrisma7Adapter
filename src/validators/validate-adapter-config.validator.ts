import { AdapterErrorCode, VSLogLevel, VSRepoAdapterError } from "vsrepo";
import { VSRepoPrisma7AdapterConfig } from "../types/adapter-config.type.js";
import { PRISMA_PROVIDERS, PrismaProvidersSet } from "../resolvers/resolve-provider.resolver.js";

const VALID_MODES = ["otm", "mtm", "mto", "oto"] as const;
const VALID_RESTRICTIONS = ["set", "add"] as const;
const VALID_RELATION_KEYS = new Set(["mode", "restriction", "pk", "nullable"]);
const VALID_LOG_LEVELS = new Set(Object.values(VSLogLevel).filter((v): v is number => typeof v === "number"));

function fail(path: string, message: string): never {
    throw new VSRepoAdapterError(
        `Invalid constructor config (${path}): ${message}`,
        AdapterErrorCode.INVALID_ADAPTER_CONFIG,
        null,
    );
}

function validateRelation(key: string, rel: unknown): void {
    const path = `relations.${key}`;

    if (typeof rel !== "object" || rel === null || Array.isArray(rel)) {
        fail(path, "must be an object");
    }

    const r = rel as Record<string, unknown>;

    for (const k of Object.keys(r)) {
        if (!VALID_RELATION_KEYS.has(k)) {
            fail(`${path}.${k}`, `unknown key '${k}'`);
        }
    }

    if (!VALID_MODES.includes(r.mode as (typeof VALID_MODES)[number])) {
        fail(`${path}.mode`, `must be one of: ${VALID_MODES.join(", ")}`);
    }

    if (!VALID_RESTRICTIONS.includes(r.restriction as (typeof VALID_RESTRICTIONS)[number])) {
        fail(`${path}.restriction`, `must be one of: ${VALID_RESTRICTIONS.join(", ")}`);
    }

    if (typeof r.pk !== "string" || r.pk.length === 0) {
        fail(`${path}.pk`, "must be a non-empty string");
    }

    if (r.nullable !== undefined && typeof r.nullable !== "boolean") {
        fail(`${path}.nullable`, "must be a boolean");
    }

    if (r.nullable === true && r.mode !== "mto" && r.mode !== "oto") {
        fail(
            `${path}.nullable`,
            "'nullable: true' is only valid for 'mto' and 'oto' relations; 'otm' and 'mtm' relations do not support 'nullable'.",
        );
    }
}

/**
 * Valida a config recebida pelo construtor do `VSRepoPrisma7Adapter` (`tableName`,
 * `pkName`, `relations` opcional e `logLevel` opcional), lançando
 * `VSRepoAdapterError` (code `INVALID_ADAPTER_CONFIG`) com uma mensagem apontando
 * o campo inválido.
 */
export function validateAdapterConfig<T>(config: unknown): VSRepoPrisma7AdapterConfig<T> {
    if (typeof config !== "object" || config === null || Array.isArray(config)) {
        fail("config", "must be an object");
    }

    const c = config as Record<string, unknown>;

    if (typeof c.tableName !== "string" || c.tableName.length === 0) {
        fail("tableName", "must be a non-empty string");
    }

    if (typeof c.pkName !== "string" || c.pkName.length === 0) {
        fail("pkName", "must be a non-empty string");
    }

    if (c.relations !== undefined) {
        if (typeof c.relations !== "object" || c.relations === null || Array.isArray(c.relations)) {
            fail("relations", "must be an object");
        }

        for (const key of Object.keys(c.relations as object)) {
            validateRelation(key, (c.relations as Record<string, unknown>)[key]);
        }
    }

    if (c.logLevel !== undefined && !VALID_LOG_LEVELS.has(c.logLevel as number)) {
        fail("logLevel", `must be a valid VSLogLevel value (${[...VALID_LOG_LEVELS].join(", ")})`);
    }

    if (c.provider !== undefined && !PrismaProvidersSet.has(c.provider as string)) {
        fail(
            "provider",
            `must be one of: ${PRISMA_PROVIDERS.join(", ")} (or omitted so it's detected from the Prisma client)`,
        );
    }

    if (
        c.logSlowThresholdMs !== undefined &&
        typeof c.logSlowThresholdMs !== "boolean" &&
        (typeof c.logSlowThresholdMs !== "number" || c.logSlowThresholdMs <= 0)
    ) {
        fail("logSlowThresholdMs", "must be a number greater than 0, or a boolean");
    }

    return config as VSRepoPrisma7AdapterConfig<T>;
}
