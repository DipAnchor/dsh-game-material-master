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
 * 渠道层结构版本，语义同 `ROW_ORDER_VERSION`：
 * 迁移只在「版本号缺失」时发生一次，之后用户把渠道全删光也不会被重新种回来。
 */
export const CHANNEL_VERSION = 1;
/** 空的用途绑定（`supplierId` 为空串 = 没绑，解析回落到扁平字段）。 */
export function emptyBindConfig() {
    return {
        image: { default: { supplierId: "" }, sheet: { supplierId: "" }, redraw: { supplierId: "" } },
        video: { default: { supplierId: "" } }
    };
}
export const DEFAULT_CONFIG = {
    arkApiKey: "",
    arkBaseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    arkModel: "doubao-seedream-4-0-250828",
    /** 默认跟随主模型；需要时可在设置里单独指定。 */
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
    minimaxTimeoutMs: 120000,
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
    suppliers: {},
    bind: emptyBindConfig(),
    channelSecrets: {},
    channelVersion: CHANNEL_VERSION
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
/** 绑定的供应商必须存在，否则视作没绑（解析会回落到扁平字段）。 */
function normalizeSlot(value, suppliers) {
    const raw = asDict(value);
    const supplierId = asString(raw.supplierId, "").trim();
    if (supplierId === "" || suppliers[supplierId] === undefined)
        return { supplierId: "" };
    const model = asString(raw.model, "").trim();
    return model === "" ? { supplierId } : { supplierId, model };
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
    const suppliers = {};
    for (const [id, value] of Object.entries(asDict(raw.suppliers))) {
        if (!isChannelId(id))
            continue;
        const record = asDict(value);
        const channelId = asString(record.channelId, "").trim();
        if (channels[channelId] === undefined)
            continue; // 悬空引用 → 丢弃该供应商
        suppliers[id] = { name: (asString(record.name, "").trim() || id).slice(0, 80), channelId };
    }
    const bind = emptyBindConfig();
    const rawBind = asDict(raw.bind);
    const rawImage = asDict(rawBind.image);
    bind.image.default = normalizeSlot(rawImage.default, suppliers);
    bind.image.sheet = normalizeSlot(rawImage.sheet, suppliers);
    bind.image.redraw = normalizeSlot(rawImage.redraw, suppliers);
    bind.video.default = normalizeSlot(asDict(rawBind.video).default, suppliers);
    const channelSecrets = {};
    for (const [id, value] of Object.entries(asDict(raw.channelSecrets))) {
        if (suppliers[id] === undefined)
            continue; // 密钥只对存在的供应商有意义
        if (typeof value === "string" && value.trim() !== "")
            channelSecrets[id] = value;
    }
    return { channels, suppliers, bind, channelSecrets };
}
/**
 * 一次性迁移：把旧的扁平字段折成「一个渠道 + 一个供应商」，并绑好三个用途。
 *
 * 两处刻意的取舍：
 *
 * - **只为「部件重绘」换模型，不另建供应商。** 旧配置只有一把 key；凭空造第二个账号会让
 *   两份 secret 各自漂移（改了主账号那个、重绘还在用旧 key）。
 * - id 固定（渠道 `ark-cn` / `mm-intl`，供应商 `ark-main` / `mm-main`），方便排错与文档引用。
 */
function migrateFlatToChannels(flat) {
    const channels = {};
    const suppliers = {};
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
    suppliers["ark-main"] = { name: "默认账号", channelId: "ark-cn" };
    if (flat.arkApiKey.trim() !== "")
        channelSecrets["ark-main"] = flat.arkApiKey;
    bind.image.default = { supplierId: "ark-main" };
    bind.image.sheet = { supplierId: "ark-main" };
    bind.image.redraw =
        redraw === "" || redraw === flat.arkModel
            ? { supplierId: "ark-main" }
            : { supplierId: "ark-main", model: redraw };
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
    suppliers["mm-main"] = { name: "默认账号", channelId: "mm-intl" };
    if (flat.minimaxApiKey.trim() !== "")
        channelSecrets["mm-main"] = flat.minimaxApiKey;
    bind.video.default = { supplierId: "mm-main" };
    return { channels, suppliers, bind, channelSecrets };
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
    // 视频参数都跟着模型走：换到 H3 之后旧的 `1080P` / `6 秒` 未必合法；
    // 选「优云智算版 H3」时档位放宽到 1080P、4~30 秒。
    const minimaxModel = asString(raw.minimaxModel, DEFAULT_CONFIG.minimaxModel);
    const minimaxBaseUrl = normalizeVideoBaseUrl(asString(raw.minimaxBaseUrl, DEFAULT_CONFIG.minimaxBaseUrl)) || DEFAULT_CONFIG.minimaxBaseUrl;
    // 时长 / 分辨率按模型收敛一次再落盘：换过模型之后，旧档位可能已经不合法了。
    const minimaxParams = normalizeVideoParams(minimaxModel, {
        duration: raw.minimaxDuration ?? DEFAULT_CONFIG.minimaxDuration,
        resolution: raw.minimaxResolution ?? DEFAULT_CONFIG.minimaxResolution
    });
    const flat = {
        arkApiKey: asString(raw.arkApiKey, DEFAULT_CONFIG.arkApiKey),
        arkBaseUrl: asString(raw.arkBaseUrl, DEFAULT_CONFIG.arkBaseUrl).replace(/\/+$/, ""),
        arkModel: asString(raw.arkModel, DEFAULT_CONFIG.arkModel),
        arkRedrawModel: asString(raw.arkRedrawModel, DEFAULT_CONFIG.arkRedrawModel),
        arkSize: asString(raw.arkSize, DEFAULT_CONFIG.arkSize),
        arkWatermark: asBool(raw.arkWatermark, DEFAULT_CONFIG.arkWatermark),
        arkTimeoutMs: asInt(raw.arkTimeoutMs, DEFAULT_CONFIG.arkTimeoutMs, 10000, 900000),
        minimaxApiKey: asString(raw.minimaxApiKey, DEFAULT_CONFIG.minimaxApiKey),
        minimaxBaseUrl,
        minimaxModel,
        minimaxDuration: minimaxParams.duration,
        minimaxResolution: minimaxParams.resolution,
        minimaxPromptOptimizer: asBool(raw.minimaxPromptOptimizer, DEFAULT_CONFIG.minimaxPromptOptimizer),
        minimaxTimeoutMs: asInt(raw.minimaxTimeoutMs, DEFAULT_CONFIG.minimaxTimeoutMs, 10000, 900000),
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
    // 渠道层：先把读入的结构归一化；只有「从没迁过 且 一条渠道都没有」时，
    // 才把扁平字段折成渠道。channelVersion 一旦落盘，用户把渠道全删光也不会被重新种回来。
    const layer = normalizeChannelLayer(raw);
    const channelLayer = raw.channelVersion === undefined && Object.keys(layer.channels).length === 0
        ? migrateFlatToChannels(flat)
        : layer;
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
        cache = { ...DEFAULT_CONFIG, rowOrder: [...DEFAULT_ROW_ORDER] };
    }
    return cache;
}
/**
 * ── 双向投影（U1 专有，U4 删除）────────────────────────────────────────
 *
 * 旧设置页**只写扁平字段**，新 RPC**只写渠道层**，而解析一律读渠道层。
 * 所以两边必须互为投影，否则「旧页面看着生效、其实没生效」。
 *
 * 方向由「这次写的是哪一边」决定，见 `saveConfig`。
 */
/** 按注册表约定，两组扁平字段各自对应的默认渠道 / 供应商 id。 */
const IMAGE_DEFAULT_SUPPLIER = "ark-main";
const IMAGE_DEFAULT_CHANNEL = "ark-cn";
const VIDEO_DEFAULT_SUPPLIER = "mm-main";
const VIDEO_DEFAULT_CHANNEL = "mm-intl";
/** 扁平字段 → 默认渠道 / 供应商（旧设置页写完走这一步）。 */
export function projectFlatToChannels(config) {
    const channels = { ...config.channels };
    const suppliers = { ...config.suppliers };
    const channelSecrets = { ...config.channelSecrets };
    const bind = { image: { ...config.bind.image }, video: { ...config.bind.video } };
    // ── 生图组 ──
    const imageSupplierId = bind.image.default.supplierId || IMAGE_DEFAULT_SUPPLIER;
    const imageChannelId = suppliers[imageSupplierId]?.channelId || IMAGE_DEFAULT_CHANNEL;
    const imageModels = [{ id: config.arkModel }];
    const redraw = config.arkRedrawModel.trim();
    if (redraw !== "" && redraw !== config.arkModel)
        imageModels.push({ id: redraw });
    channels[imageChannelId] = {
        protocol: channels[imageChannelId]?.protocol ?? "ark",
        name: channels[imageChannelId]?.name ?? "火山方舟",
        baseUrl: config.arkBaseUrl,
        models: imageModels,
        options: { size: config.arkSize, watermark: config.arkWatermark, timeoutMs: config.arkTimeoutMs }
    };
    suppliers[imageSupplierId] = { name: suppliers[imageSupplierId]?.name ?? "默认账号", channelId: imageChannelId };
    if (config.arkApiKey.trim() !== "")
        channelSecrets[imageSupplierId] = config.arkApiKey;
    else
        delete channelSecrets[imageSupplierId];
    bind.image.default = { supplierId: imageSupplierId };
    if (bind.image.sheet.supplierId === "")
        bind.image.sheet = { supplierId: imageSupplierId };
    bind.image.redraw =
        redraw === "" || redraw === config.arkModel
            ? { supplierId: bind.image.redraw.supplierId || imageSupplierId }
            : { supplierId: bind.image.redraw.supplierId || imageSupplierId, model: redraw };
    // ── 视频组 ──
    const videoSupplierId = bind.video.default.supplierId || VIDEO_DEFAULT_SUPPLIER;
    const videoChannelId = suppliers[videoSupplierId]?.channelId || VIDEO_DEFAULT_CHANNEL;
    channels[videoChannelId] = {
        protocol: channels[videoChannelId]?.protocol ?? "minimax",
        name: channels[videoChannelId]?.name ?? "MiniMax",
        baseUrl: config.minimaxBaseUrl,
        models: [{ id: config.minimaxModel }],
        options: {
            duration: config.minimaxDuration,
            resolution: config.minimaxResolution,
            promptOptimizer: config.minimaxPromptOptimizer,
            timeoutMs: config.minimaxTimeoutMs
        }
    };
    suppliers[videoSupplierId] = { name: suppliers[videoSupplierId]?.name ?? "默认账号", channelId: videoChannelId };
    if (config.minimaxApiKey.trim() !== "")
        channelSecrets[videoSupplierId] = config.minimaxApiKey;
    else
        delete channelSecrets[videoSupplierId];
    bind.video.default = { supplierId: videoSupplierId };
    return { ...config, channels, suppliers, bind, channelSecrets };
}
/** 渠道层 → 扁平字段（新 RPC 写完走这一步）。 */
export function projectChannelsToFlat(config) {
    const imageSlot = config.bind.image.default;
    const videoSlot = config.bind.video.default;
    const imageSupplier = config.suppliers[imageSlot.supplierId];
    const videoSupplier = config.suppliers[videoSlot.supplierId];
    const imageChannel = imageSupplier === undefined ? undefined : config.channels[imageSupplier.channelId];
    const videoChannel = videoSupplier === undefined ? undefined : config.channels[videoSupplier.channelId];
    const imageOptions = imageChannel?.options ?? {};
    const videoOptions = videoChannel?.options ?? {};
    const num = (value, fallback) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
    return {
        ...config,
        // 只有绑到东西时才回写，否则保留原状（渠道全空时不该把扁平字段清成默认值）。
        ...(imageChannel === undefined
            ? {}
            : {
                arkBaseUrl: imageChannel.baseUrl,
                arkModel: imageSlot.model ?? imageChannel.models[0]?.id ?? config.arkModel,
                arkRedrawModel: config.bind.image.redraw.model ??
                    (config.bind.image.redraw.supplierId === imageSlot.supplierId ? config.arkRedrawModel : ""),
                arkSize: typeof imageOptions.size === "string" ? imageOptions.size : config.arkSize,
                arkWatermark: typeof imageOptions.watermark === "boolean" ? imageOptions.watermark : config.arkWatermark,
                arkTimeoutMs: num(imageOptions.timeoutMs, config.arkTimeoutMs)
            }),
        ...(imageSupplier === undefined ? {} : { arkApiKey: config.channelSecrets[imageSlot.supplierId] ?? "" }),
        ...(videoChannel === undefined
            ? {}
            : {
                minimaxBaseUrl: videoChannel.baseUrl,
                minimaxModel: videoSlot.model ?? videoChannel.models[0]?.id ?? config.minimaxModel,
                minimaxDuration: num(videoOptions.duration, config.minimaxDuration),
                minimaxResolution: typeof videoOptions.resolution === "string" ? videoOptions.resolution : config.minimaxResolution,
                minimaxPromptOptimizer: typeof videoOptions.promptOptimizer === "boolean"
                    ? videoOptions.promptOptimizer
                    : config.minimaxPromptOptimizer,
                minimaxTimeoutMs: num(videoOptions.timeoutMs, config.minimaxTimeoutMs)
            }),
        ...(videoSupplier === undefined ? {} : { minimaxApiKey: config.channelSecrets[videoSlot.supplierId] ?? "" })
    };
}
/** 渠道层的四个键；`saveConfig` 用它判断「这次写的是哪一边」。 */
const CHANNEL_LAYER_KEYS = ["channels", "suppliers", "bind", "channelSecrets"];
export async function saveConfig(patch) {
    const current = await loadConfig();
    const merged = { ...current, ...patch };
    // 写的是哪一边，就把另一边同步过来。见文件头的双向投影说明。
    const wroteChannels = CHANNEL_LAYER_KEYS.some((key) => patch[key] !== undefined);
    const next = normalizeConfig(wroteChannels ? projectChannelsToFlat(merged) : projectFlatToChannels(merged));
    await mkdir(dataRoot(), { recursive: true });
    const target = configPath();
    const tmp = `${target}.tmp`;
    await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    await rename(tmp, target);
    cache = next;
    return next;
}
export function maskConfig(config) {
    const { arkApiKey, minimaxApiKey, channelSecrets: _channelSecrets, channels: _channels, suppliers: _suppliers, bind: _bind, ...rest } = config;
    return {
        ...rest,
        rowOrder: [...config.rowOrder],
        arkApiKeySet: arkApiKey.trim() !== "",
        arkApiKeyHint: hintOf(arkApiKey),
        minimaxApiKeySet: minimaxApiKey.trim() !== "",
        minimaxApiKeyHint: hintOf(minimaxApiKey)
    };
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
