import { VSRepoRelations } from "vsrepo";
import { PlainObject } from "../types/plain-object.type.js";
import { isPlainObject } from "../validators/is-plain-object.validator.js";

export function parsePrismaInclude<T>(relations: VSRepoRelations<T>): PlainObject {
    const include: PlainObject = {};

    for (const [key, value] of Object.entries(relations)) {
        if (isPlainObject(value)) {
            include[key] = { include: parsePrismaInclude(value) };
        } else {
            include[key] = value;
        }
    }

    return include;
}
