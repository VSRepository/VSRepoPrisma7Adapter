import { VSRepoSelect } from "vsrepo";
import { PlainObject } from "../types/plain-object.type.js";
import { isPlainObject } from "../validators/is-plain-object.validator.js";

export function parsePrismaSelect<T>(relations: VSRepoSelect<T>): PlainObject {
    const select: PlainObject = {};

    for (const [key, value] of Object.entries(relations)) {
        if (isPlainObject(value)) {
            select[key] = { select: parsePrismaSelect(value) };
        } else {
            select[key] = value;
        }
    }

    return select;
}
