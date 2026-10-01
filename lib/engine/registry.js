/**
 * 实例注册表。
 *
 * 新增一家厂商＝写一个实例（`./instances/<name>.ts`）并在这里登记一行。
 * 调用方不感知这个表，它只通过 `./index.ts` 的门面拿能力。
 */
import { arkImageInstance } from "./instances/ark.js";
import { minimaxVideoInstance } from "./instances/minimax.js";
const IMAGE_INSTANCES = [arkImageInstance];
const VIDEO_INSTANCES = [minimaxVideoInstance];
export function listImageInstances() {
    return IMAGE_INSTANCES;
}
export function listVideoInstances() {
    return VIDEO_INSTANCES;
}
function pick(instances, id) {
    const hit = instances.find((instance) => instance.id === id);
    if (hit === undefined) {
        const available = instances.map((instance) => instance.id).join("、");
        throw new Error(`未知的生成实例「${id}」（可用：${available}）`);
    }
    return hit;
}
export function imageInstance(id) {
    return pick(IMAGE_INSTANCES, id);
}
export function videoInstance(id) {
    return pick(VIDEO_INSTANCES, id);
}
