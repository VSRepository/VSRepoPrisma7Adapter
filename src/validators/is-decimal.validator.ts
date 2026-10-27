import { DecimalLike } from "vsrepo";

export function isDecimal(value: any): value is DecimalLike {
    return (
        typeof value === "object" &&
        value !== null &&
        typeof value.toNumber === "function" &&
        typeof value.toFixed === "function" &&
        typeof value.toString === "function" &&
        typeof value.decimalPlaces === "function"
    );
}
