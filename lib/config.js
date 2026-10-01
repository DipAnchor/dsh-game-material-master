/**
 * 插件配置：API 凭证、模型选择、以及整条流水线的默认参数。
 *
 * 落盘位置：`${DSH_HOME:-~/.dsh}/game-material-master/config.json`。
 * Key 只存在宿主本机，从不回传给浏览器明文（`maskConfig` 负责脱敏）。
 */
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_ROW_ORDER } from "./directions.js";
/**
 * 上一版的默认行序（按生成依赖顺序）。方位语义修正后，默认改成罗盘顺时针；
 * 配置里还留着旧默认值的用户应当自动迁过去，而不是被卡在旧顺序上。
 */
const LEGACY_ROW_ORDER = ["front", "back", "downLeft", "downRight", "upLeft", "upRight", "left", "right"];
/**
 * 行序语义版本。1 = 旧的生成依赖顺序，2 = 罗盘顺时针。
 * 迁移只在「没有版本号且恰好等于旧默认值」时发生一次，之后用户显式设成
 * 任何顺序（哪怕是旧默认那串）都会被尊重，不会被反复迁走。
 */
export const ROW_ORDER_VERSION = 2;
/** 判断一份行序是不是「上一版的默认值」。 */
export function isLegacyRowOrder(order) {
    return (Array.isArray(order) &&
        order.length === LEGACY_ROW_ORDER.length &&
        order.every((key, index) => key === LEGACY_ROW_ORDER[index]));
}
import { normalizeVideoBaseUrl, normalizeVideoParams } from "./engine/index.js";
import { listImageInstances, listVideoInstances } from "./engine/registry.js";
export function dshHome() {
    const raw = process.env.DSH_HOME?.trim();
    return raw && raw !== "" ? raw : join(homedir(), ".dsh");
}
export function dataRoot() {
    return join(dshHome(), "game-material-master");
}
export function configPath() {
    return join(dataRoot(), "config.json");
}
/** 八方向图模块的项目根。 */
export function projectsRoot() {
    return join(dataRoot(), "projects");
}
/** 图片生成模块的任务根。 */
export function imageJobsRoot() {
    return join(dataRoot(), "image-jobs");
}
/** 序列帧生成模块的任务根。 */
export function sequenceJobsRoot() {
    return join(dataRoot(), "sequence-jobs");
}
/** 骨骼动画生成模块的任务根。 */
export function rigJobsRoot() {
    return join(dataRoot(), "rig-jobs");
}
/**
 * 旧版本把数据放在 `8dir-sprites/`。第一次以新名字启动时整体搬过去，
 * 让已有项目和配置无缝接上——只搬一次，之后两个目录互不影响。
 */
export async function migrateLegacyDataRoot() {
    const legacy = join(dshHome(), "8dir-sprites");
    const current = dataRoot();
    try {
        await stat(legacy);
    }
    catch {
        return false;
    }
    try {
        await stat(current);
        return false; // 新目录已存在，不动
    }
    catch {
        /* 新目录不存在，执行迁移 */
    }
    try {
        await rename(legacy, current);
        return true;
    }
    catch {
        return false;
    }
}
/**
 * 渠道层结构版本，语义同 `ROW_ORDER_VERSION`：迁移只在「版本号缺失 / 落后」时发生一次，
 * 之后用户把渠道全删光也不会被重新种回来。
 *
 * - `0 → 2`：扁平字段（`arkApiKey` / `minimaxApiKey` …）折成渠道 + 密钥。
 * - `1 → 2`：把「供应商」那一层并回渠道（密钥从供应商 id 改挂到渠道 id）。
 */
export const CHANNEL_VERSION = 2;
/** 空的用途绑定（`channelId` 为空串 = 没绑）。 */
export function emptyBindConfig() {
    return {
        image: { default: { channelId: "" }, sheet: { channelId: "" }, redraw: { channelId: "" } },
        video: { default: { channelId: "" } }
    };
}
export const DEFAULT_CONFIG = {
    cellWidth: 256,
    cellHeight: 256,
    frameCount: 8,
    fitMode: "contain",
    workingLongEdge: 768,
    pixelSize: 0,
    autoCrop: true,
    fillRatio: 0.94,
    bottomMargin: 2,
    cropInset: 0,
    keyLow: 14,
    keyHigh: 80,
    despill: 0.65,
    bgTolerance: 90,
    edgeShrink: 0,
    rowOrder: [...DEFAULT_ROW_ORDER],
    rowOrderVersion: ROW_ORDER_VERSION,
    concurrency: 3,
    channels: {},
    bind: emptyBindConfig(),
    channelSecrets: {},
    // 默认给 **0**（＝没迁过）：全新安装与「只有扁平字段的老配置」走同一条迁移，
    // 于是新装也自带两条默认渠道，而不是让用户对着一个空列表发呆。
    // 真正落过盘之后是 `CHANNEL_VERSION`，用户把渠道全删光也不会被重新种回来。
    channelVersion: 0
};
function asInt(value, fallback, min, max) {
    const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
    if (!Number.isFinite(n))
        return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
}
function asBool(value, fallback) {
    return typeof value === "boolean" ? value : fallback;
}
function asString(value, fallback) {
    return typeof value === "string" ? value : fallback;
}
function asNumber(value, fallback, min, max) {
    const n = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
    if (!Number.isFinite(n))
        return fallback;
    return Math.min(max, Math.max(min, n));
}
/**
 * 迁移用的默认值：**冻结的历史值**，不是当前默认值。
 *
 * 它们已经不再用于生成新配置（新配置的地址与模型来自渠道）。但把一份「只填了一半」
 * 的老 `config.json` 折成渠道时，缺席的那一半需要历史默认值兜着——若改用「今天的
 * 默认值」，迁移结果会随着以后改默认值而漂移，同一条老配置迁两次可能得到不同结果。
 */
const LEGACY_FLAT_DEFAULTS = {
    arkApiKey: "",
    arkBaseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    arkModel: "doubao-seedream-4-0-250828",
    arkRedrawModel: "",
    arkSize: "2K",
    arkWatermark: false,
    arkTimeoutMs: 180000,
    minimaxApiKey: "",
    minimaxBaseUrl: "https://api.minimaxi.com",
    minimaxModel: "MiniMax-H3",
    minimaxDuration: 5,
    minimaxResolution: "2K",
    minimaxPromptOptimizer: true,
    minimaxTimeoutMs: 120000
};
/** 从盘上读回来的原始记录里取一份旧版扁平配置（缺席项用冻结的历史默认值）。 */
function legacyFlatOf(raw) {
    const text = (key) => asString(raw[key], LEGACY_FLAT_DEFAULTS[key]);
    const model = text("minimaxModel");
    // 时长 / 分辨率按模型收敛一次再落盘：老配置里换过模型之后，旧档位可能已经不合法。
    const params = normalizeVideoParams(model, {
        duration: raw.minimaxDuration ?? LEGACY_FLAT_DEFAULTS.minimaxDuration,
        resolution: raw.minimaxResolution ?? LEGACY_FLAT_DEFAULTS.minimaxResolution
    });
    return {
        arkApiKey: text("arkApiKey"),
        arkBaseUrl: text("arkBaseUrl").replace(/\/+$/, ""),
        arkModel: text("arkModel"),
        arkRedrawModel: text("arkRedrawModel"),
        arkSize: text("arkSize"),
        arkWatermark: asBool(raw.arkWatermark, LEGACY_FLAT_DEFAULTS.arkWatermark),
        arkTimeoutMs: asInt(raw.arkTimeoutMs, LEGACY_FLAT_DEFAULTS.arkTimeoutMs, 10000, 900000),
        minimaxApiKey: text("minimaxApiKey"),
        minimaxBaseUrl: normalizeVideoBaseUrl(text("minimaxBaseUrl")) || LEGACY_FLAT_DEFAULTS.minimaxBaseUrl,
        minimaxModel: model,
        minimaxDuration: params.duration,
        minimaxResolution: params.resolution,
        minimaxPromptOptimizer: asBool(raw.minimaxPromptOptimizer, LEGACY_FLAT_DEFAULTS.minimaxPromptOptimizer),
        minimaxTimeoutMs: asInt(raw.minimaxTimeoutMs, LEGACY_FLAT_DEFAULTS.minimaxTimeoutMs, 10000, 900000)
    };
}
/** 读成普通对象（数组、null、标量一律当空对象）。 */
function asDict(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? value
        : {};
}
function asList(value) {
    return Array.isArray(value) ? value : [];
}
/** 渠道 / 供应商 id 的规范。 */
function isChannelId(value) {
    return /^[a-z0-9][a-z0-9-]{0,39}$/.test(value);
}
/** 协议 id 必须落在注册表里——协议错会让整条渠道发错形状，所以宁可丢掉整条渠道。 */
export function isProtocolId(value) {
    return listImageInstances().some((item) => item.id === value) || listVideoInstances().some((item) => item.id === value);
}
function normalizeModelEntry(value) {
    if (typeof value === "string") {
        const id = value.trim();
        return id === "" ? undefined : { id };
    }
    const raw = asDict(value);
    const id = asString(raw.id, "").trim();
    if (id === "")
        return undefined;
    const label = asString(raw.label, "").trim();
    return label === "" ? { id } : { id, label: label.slice(0, 60) };
}
function normalizeChannel(id, value) {
    const raw = asDict(value);
    const protocol = asString(raw.protocol, "").trim();
    if (!isProtocolId(protocol))
        return undefined;
    const baseUrl = asString(raw.baseUrl, "").trim().replace(/\/+$/, "");
    if (baseUrl === "")
        return undefined;
    const models = [];
    for (const item of asList(raw.models)) {
        const entry = normalizeModelEntry(item);
        if (entry !== undefined && !models.some((model) => model.id === entry.id))
            models.push(entry);
    }
    if (models.length === 0)
        return undefined;
    const options = asDict(raw.options);
    return {
        protocol,
        name: (asString(raw.name, "").trim() || id).slice(0, 80),
        baseUrl,
        models,
        ...(Object.keys(options).length > 0 ? { options } : {})
    };
}
/** 绑定的渠道必须存在，否则视作没绑。 */
function normalizeSlot(value, channels) {
    const raw = asDict(value);
    const channelId = asString(raw.channelId, "").trim();
    if (channelId === "" || channels[channelId] === undefined)
        return { channelId: "" };
    const model = asString(raw.model, "").trim();
    return model === "" ? { channelId } : { channelId, model };
}
/**
 * 渠道层归一化。
 *
 * 和上面那组扁平字段一样是**逐字段重建**，所以新增字段必须显式列进这里——
 * 漏一个就等于「用户下次保存任意设置时把它清空」。
 */
function normalizeChannelLayer(raw) {
    const channels = {};
    for (const [id, value] of Object.entries(asDict(raw.channels))) {
        if (!isChannelId(id))
            continue;
        const channel = normalizeChannel(id, value);
        if (channel !== undefined)
            channels[id] = channel;
    }
    const bind = emptyBindConfig();
    const rawBind = asDict(raw.bind);
    const rawImage = asDict(rawBind.image);
    bind.image.default = normalizeSlot(rawImage.default, channels);
    bind.image.sheet = normalizeSlot(rawImage.sheet, channels);
    bind.image.redraw = normalizeSlot(rawImage.redraw, channels);
    bind.video.default = normalizeSlot(asDict(rawBind.video).default, channels);
    const channelSecrets = {};
    for (const [id, value] of Object.entries(asDict(raw.channelSecrets))) {
        if (channels[id] === undefined)
            continue; // 密钥只对存在的渠道有意义
        if (typeof value === "string" && value.trim() !== "")
            channelSecrets[id] = value;
    }
    return { channels, bind, channelSecrets };
}
/**
 * `0 → 2` 一次性迁移：把旧的扁平字段折成两条渠道，并绑好用途。
 *
 * 两处刻意的取舍：
 *
 * - **「部件重绘」只换模型，不另建渠道。** 旧配置只有一把 key；凭空造第二条渠道会让两份
 *   密钥各自漂移（改了主渠道那把、重绘还在用旧 key）。
 * - id 固定（`ark-cn` / `mm-intl`），方便排错与文档引用。
 */
function migrateFlatToChannels(raw) {
    const flat = legacyFlatOf(raw);
    const channels = {};
    const channelSecrets = {};
    const bind = emptyBindConfig();
    const redraw = flat.arkRedrawModel.trim();
    const imageModels = [{ id: flat.arkModel }];
    if (redraw !== "" && redraw !== flat.arkModel)
        imageModels.push({ id: redraw });
    channels["ark-cn"] = {
        protocol: "ark",
        name: "火山方舟",
        baseUrl: flat.arkBaseUrl,
        models: imageModels,
        options: { size: flat.arkSize, watermark: flat.arkWatermark, timeoutMs: flat.arkTimeoutMs }
    };
    if (flat.arkApiKey.trim() !== "")
        channelSecrets["ark-cn"] = flat.arkApiKey;
    bind.image.default = { channelId: "ark-cn" };
    bind.image.sheet = { channelId: "ark-cn" };
    bind.image.redraw =
        redraw === "" || redraw === flat.arkModel ? { channelId: "ark-cn" } : { channelId: "ark-cn", model: redraw };
    channels["mm-intl"] = {
        protocol: "minimax",
        name: "MiniMax",
        baseUrl: flat.minimaxBaseUrl,
        models: [{ id: flat.minimaxModel }],
        options: {
            duration: flat.minimaxDuration,
            resolution: flat.minimaxResolution,
            promptOptimizer: flat.minimaxPromptOptimizer,
            timeoutMs: flat.minimaxTimeoutMs
        }
    };
    if (flat.minimaxApiKey.trim() !== "")
        channelSecrets["mm-intl"] = flat.minimaxApiKey;
    bind.video.default = { channelId: "mm-intl" };
    return { channels, bind, channelSecrets };
}
/**
 * `1 → 2`：把「供应商」这一层并回渠道。
 *
 * v1 的形状是 `suppliers: {id: {name, channelId}}` + `channelSecrets` 键是**供应商** id +
 * `bind[*].supplierId` 指供应商。v2 一个渠道一把密钥、绑定直接写渠道 id。
 *
 * 一条渠道上挂了多把密钥时留哪把：**优先留被用途绑定引用的那把**（那才是真在用的），
 * 其余按出现顺序补空。被丢掉的那些无法恢复——要降级先备份 config.json。
 */
function promoteSuppliers(raw) {
    const suppliers = asDict(raw.suppliers);
    const secrets = asDict(raw.channelSecrets);
    const channelOf = (id) => asString(asDict(suppliers[id]).channelId, "").trim();
    const referenced = [];
    const readSlot = (value) => {
        const supplierId = asString(asDict(value).supplierId, "").trim();
        const model = asString(asDict(value).model, "").trim();
        const channelId = supplierId === "" ? "" : channelOf(supplierId);
        if (channelId === "")
            return { channelId: "" };
        if (!referenced.includes(supplierId))
            referenced.push(supplierId);
        return model === "" ? { channelId } : { channelId, model };
    };
    const bind = emptyBindConfig();
    const rawBind = asDict(raw.bind);
    const rawImage = asDict(rawBind.image);
    bind.image.default = readSlot(rawImage.default);
    bind.image.sheet = readSlot(rawImage.sheet);
    bind.image.redraw = readSlot(rawImage.redraw);
    bind.video.default = readSlot(asDict(rawBind.video).default);
    const channelSecrets = {};
    const put = (supplierId) => {
        const channelId = channelOf(supplierId);
        const secret = secrets[supplierId];
        if (channelId === "" || typeof secret !== "string" || secret.trim() === "")
            return;
        if (channelSecrets[channelId] !== undefined)
            return;
        channelSecrets[channelId] = secret;
    };
    for (const id of referenced)
        put(id); // ① 被用途绑定引用的优先
    for (const id of Object.keys(suppliers))
        put(id); // ② 其余按顺序补空
    return { bind, channelSecrets };
}
/** 把任意读入的 JSON 收敛成一份合法配置，缺项一律回落默认值。 */
export function normalizeConfig(input) {
    const raw = (input ?? {});
    const rowOrderRaw = Array.isArray(raw.rowOrder) ? raw.rowOrder.filter((k) => typeof k === "string") : [];
    // 一次性迁移：只有「没有版本号」的旧配置才会被迁到罗盘顺序。
    const needsOrderMigration = raw.rowOrderVersion === undefined && isLegacyRowOrder(rowOrderRaw);
    const rowOrder = rowOrderRaw.length === 0 || needsOrderMigration ? [...DEFAULT_ROW_ORDER] : rowOrderRaw;
    const keyLow = asInt(raw.keyLow, DEFAULT_CONFIG.keyLow, 0, 255);
    // 上限必须严格大于下限，否则抠像区间为空；单独改任一项时自动让路。
    const keyHigh = Math.min(255, Math.max(keyLow + 1, asInt(raw.keyHigh, DEFAULT_CONFIG.keyHigh, 1, 255)));
    const flat = {
        cellWidth: asInt(raw.cellWidth, DEFAULT_CONFIG.cellWidth, 16, 2048),
        cellHeight: asInt(raw.cellHeight, DEFAULT_CONFIG.cellHeight, 16, 2048),
        frameCount: asInt(raw.frameCount, DEFAULT_CONFIG.frameCount, 1, 64),
        fitMode: raw.fitMode === "stretch" ? "stretch" : "contain",
        workingLongEdge: asInt(raw.workingLongEdge, DEFAULT_CONFIG.workingLongEdge, 128, 2048),
        pixelSize: asInt(raw.pixelSize, DEFAULT_CONFIG.pixelSize, 0, 32),
        autoCrop: asBool(raw.autoCrop, DEFAULT_CONFIG.autoCrop),
        fillRatio: asNumber(raw.fillRatio, DEFAULT_CONFIG.fillRatio, 0.5, 1),
        bottomMargin: asInt(raw.bottomMargin, DEFAULT_CONFIG.bottomMargin, 0, 64),
        cropInset: asNumber(raw.cropInset, DEFAULT_CONFIG.cropInset, 0, 0.2),
        keyLow,
        keyHigh,
        despill: asNumber(raw.despill, DEFAULT_CONFIG.despill, 0, 1),
        bgTolerance: asInt(raw.bgTolerance, DEFAULT_CONFIG.bgTolerance, 0, 160),
        edgeShrink: asInt(raw.edgeShrink, DEFAULT_CONFIG.edgeShrink, 0, 8),
        rowOrder,
        rowOrderVersion: ROW_ORDER_VERSION,
        concurrency: asInt(raw.concurrency, DEFAULT_CONFIG.concurrency, 1, 8)
    };
    // 渠道层：**版本号低于当前值就迁移一次**，之后版本号落盘，用户把渠道全删光也不会被
    // 重新种回来。全新安装（版本 0）走的是同一条路——于是新装自带两条默认渠道，
    // 而不是对着一个空列表发呆。
    //
    //   0 → 2  扁平字段折成渠道（密钥直接挂在渠道上）
    //   1 → 2  「供应商」那一层并回渠道（密钥从供应商 id 改挂渠道 id）
    const version = asInt(raw.channelVersion, 0, 0, 999);
    const channelLayer = version === 0
        ? migrateFlatToChannels(raw)
        : version < CHANNEL_VERSION
            ? { ...normalizeChannelLayer(raw), ...promoteSuppliers(raw) }
            : normalizeChannelLayer(raw);
    return { ...flat, ...channelLayer, channelVersion: CHANNEL_VERSION };
}
let cache;
export async function loadConfig() {
    if (cache !== undefined)
        return cache;
    try {
        const text = await readFile(configPath(), "utf8");
        cache = normalizeConfig(JSON.parse(text));
    }
    catch {
        // 没有配置文件：**也要走一遍归一化**，而不是直接拼 DEFAULT_CONFIG——
        // 全新安装与「只有扁平字段的老配置」是同一条迁移路径，新装正是靠它拿到两条默认渠道。
        cache = normalizeConfig({});
    }
    return cache;
}
/**
 * U4：`projectFlatToChannels` / `projectChannelsToFlat`（U1 的双向投影）已删除。
 *
 * 它们当时存在，是因为**旧设置页只写扁平字段、新 RPC 只写渠道层，而解析一律读渠道层**
 * ——两边必须互为投影，否则「旧页面看着生效、其实没生效」。
 *
 * 扁平字段删掉之后只剩一边，投影自然消失，`saveConfig` 回到一次普通的合并 + 归一化。
 */
export async function saveConfig(patch) {
    const current = await loadConfig();
    const next = normalizeConfig({ ...current, ...patch });
    await mkdir(dataRoot(), { recursive: true });
    const target = configPath();
    const tmp = `${target}.tmp`;
    await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    await rename(tmp, target);
    cache = next;
    return next;
}
export function maskConfig(config) {
    const { channelSecrets: _channelSecrets, channels: _channels, bind: _bind, ...rest } = config;
    return { ...rest, rowOrder: [...config.rowOrder] };
}
/** 密钥提示：空 = 没配；很短 = 只说「已配置」；否则给尾 4 位。渠道视图也用它。 */
export function hintOf(key) {
    const trimmed = key.trim();
    if (trimmed === "")
        return "";
    if (trimmed.length <= 8)
        return "已配置";
    return `…${trimmed.slice(-4)}`;
}
