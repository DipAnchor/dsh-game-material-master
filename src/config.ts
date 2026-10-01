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
export function isLegacyRowOrder(order: unknown): boolean {
  return (
    Array.isArray(order) &&
    order.length === LEGACY_ROW_ORDER.length &&
    order.every((key, index) => key === LEGACY_ROW_ORDER[index])
  );
}
import { normalizeVideoBaseUrl, normalizeVideoParams } from "./engine/index.js";
import { listImageInstances, listVideoInstances } from "./engine/registry.js";

export function dshHome(): string {
  const raw = process.env.DSH_HOME?.trim();
  return raw && raw !== "" ? raw : join(homedir(), ".dsh");
}

export function dataRoot(): string {
  return join(dshHome(), "game-material-master");
}

export function configPath(): string {
  return join(dataRoot(), "config.json");
}

/** 八方向图模块的项目根。 */
export function projectsRoot(): string {
  return join(dataRoot(), "projects");
}

/** 图片生成模块的任务根。 */
export function imageJobsRoot(): string {
  return join(dataRoot(), "image-jobs");
}

/** 序列帧生成模块的任务根。 */
export function sequenceJobsRoot(): string {
  return join(dataRoot(), "sequence-jobs");
}

/** 骨骼动画生成模块的任务根。 */
export function rigJobsRoot(): string {
  return join(dataRoot(), "rig-jobs");
}

/**
 * 旧版本把数据放在 `8dir-sprites/`。第一次以新名字启动时整体搬过去，
 * 让已有项目和配置无缝接上——只搬一次，之后两个目录互不影响。
 */
export async function migrateLegacyDataRoot(): Promise<boolean> {
  const legacy = join(dshHome(), "8dir-sprites");
  const current = dataRoot();
  try {
    await stat(legacy);
  } catch {
    return false;
  }
  try {
    await stat(current);
    return false; // 新目录已存在，不动
  } catch {
    /* 新目录不存在，执行迁移 */
  }
  try {
    await rename(legacy, current);
    return true;
  } catch {
    return false;
  }
}

/**
 * ── 渠道层 ──────────────────────────────────────────────────────────────
 *
 * 三层各自只管一件事：
 *
 *   - **供应商**（账号）= 一把 API Key，只回答「用谁的 key」；
 *   - **渠道** = 一个 API 地址 + 一个协议 + 一组模型，只回答「打到哪、怎么说」；
 *   - **模型条目** = 一个上游 model（加一个可选显示名）。
 *
 * 基数：供应商 **N:1** 渠道（`supplier.channelId` 是单值）、渠道 **1:N** 模型、
 * 渠道 **1:N** 供应商（同一个端点可以配多把 key）。
 *
 * 密钥单独一层（`channelSecrets`，**键是供应商**）：任何一次整对象写回都会覆盖
 * 没重填的字段；密钥外置之后，供应商与渠道对象里根本没有 secret。
 *
 * 协议（`protocol`）配在**渠道**上——它描述的是「这个端点怎么说话」，
 * 而一个端点只有一种说法。所以模型条目里**没有**协议字段。
 */

/** 协议 id：取值由 `engine/registry.ts` 的实例 id 决定（`ark` / `minimax` / …）。 */
export type ProtocolId = string;

/** 一个上游模型条目。`id` 是身份（任务快照记它），`label` 只是显示名。 */
export interface ModelEntry {
  id: string;
  label?: string;
}

export interface ChannelConfig {
  /** 协议：用哪套形状跟这个端点说话。 */
  protocol: ProtocolId;
  name: string;
  /** 主机根地址（已去掉尾部斜杠）。 */
  baseUrl: string;
  models: ModelEntry[];
  /** 协议私有参数（方舟的 `size` / `watermark`，MiniMax 的 `duration` / `resolution`…）。 */
  options?: Record<string, unknown>;
}

/** 供应商 = 一个账号 / 一把 Key。 */
export interface SupplierConfig {
  name: string;
  channelId: string;
}

/** 一个用途的绑定：用哪个供应商，以及（可选）默认用它的哪个模型。 */
export interface BindSlot {
  supplierId: string;
  /** 缺省 = 该渠道的第一个模型。 */
  model?: string;
}

export type ImagePurpose = "default" | "sheet" | "redraw";

export interface BindConfig {
  image: Record<ImagePurpose, BindSlot>;
  video: { default: BindSlot };
}

/**
 * 渠道层结构版本，语义同 `ROW_ORDER_VERSION`：
 * 迁移只在「版本号缺失」时发生一次，之后用户把渠道全删光也不会被重新种回来。
 */
export const CHANNEL_VERSION = 1;

/** 空的用途绑定（`supplierId` 为空串 = 没绑，解析回落到扁平字段）。 */
export function emptyBindConfig(): BindConfig {
  return {
    image: { default: { supplierId: "" }, sheet: { supplierId: "" }, redraw: { supplierId: "" } },
    video: { default: { supplierId: "" } }
  };
}

export interface Config {
  /** 火山方舟（Ark）API Key。 */
  arkApiKey: string;
  arkBaseUrl: string;
  /** 生图模型 ID，也支持推理接入点 ID（ep-xxxx）。 */
  arkModel: string;
  /**
   * **部件重绘**单独用的模型 ID；空串 = 跟随 `arkModel`（默认）。
   *
   * 拆件与重绘对模型的要求本来就不同（一个是「按提示词画一整张摊平图」，
   * 一个是「原地改这一小块、保持轮廓」），分开设置留出了切换空间。
   * 默认跟随主模型——没有证据表明某个模型在这个任务上系统性更好。
   */
  arkRedrawModel: string;
  /** `2K` / `1K` / `4K`，或显式 `宽x高`。 */
  arkSize: string;
  arkWatermark: boolean;
  /** 请求超时（毫秒）。 */
  arkTimeoutMs: number;

  /** MiniMax API Key。 */
  minimaxApiKey: string;
  /**
   * **主机根地址**（不含 /v1、/v2）。CN 平台是 https://api.minimax.cn。
   * 选「优云智算版 H3」时该值被忽略，插件固定走 https://cp.compshare.cn。
   */
  minimaxBaseUrl: string;
  /**
   * 图生视频模型：MiniMax-H3 / H3-Max 走 v2 协议，Hailuo / I2V 走 v1；
   * 「优云智算版 H3」是独立选项，走优云智算网关（多一层 /minimax 路径）。
   */
  minimaxModel: string;
  /** 时长（秒）。官方 H3 为 4~15（优云智算版放宽到 4~30），Hailuo 只能是 6 或 10。 */
  minimaxDuration: number;
  /** `480P` / `768P` / `1080P` / `2K`，实际有效档位取决于模型。 */
  minimaxResolution: string;
  minimaxPromptOptimizer: boolean;
  minimaxTimeoutMs: number;

  /** 最终整图单格宽高（像素）。 */
  cellWidth: number;
  cellHeight: number;
  /** 每个视频平均提取多少帧。 */
  frameCount: number;
  /** 角色在单格内的缩放方式。 */
  fitMode: "contain" | "stretch";
  /**
   * 抽帧的工作尺寸（长边像素）。合成时的自动裁剪与缩放都在这个分辨率上做，
   * 所以它决定了角色的实际清晰度上限。
   */
  workingLongEdge: number;
  /**
   * 像素块边长（输出像素）。0/1 = 关闭像素化。
   * 合成时每一块单独做盒式平均再填满整块，得到真正的硬边方块——
   * 这是确定性的后处理，不依赖生图或视频模型「愿意画像素画」。
   */
  pixelSize: number;
  /** 自动裁剪到角色包围盒（所有帧共用同一个框），让角色填满格子。 */
  autoCrop: boolean;
  /** 自动裁剪后角色占格子的比例 0.5~1。 */
  fillRatio: number;
  /** 角色在格子底部的留白像素（脚底对齐基线）。 */
  bottomMargin: number;
  /** 提取帧时先裁剪掉的边缘比例（0~0.2），用于去掉视频边缘噪点。 */
  cropInset: number;

  /** 抠绿阈值：绿色优势值低于 keyLow 视为前景，高于 keyHigh 视为背景。 */
  keyLow: number;
  keyHigh: number;
  /** 去绿溢出强度 0~1。 */
  despill: number;
  /**
   * 背景洪水填充的颜色容差（0~120）。0 = 只按绿色判据抠像。
   * 图生视频经常把纯色背景重新打光成渐变，只认绿色会在那些帧上整片失效。
   */
  bgTolerance: number;
  /** 前景边缘收缩（像素），用于去掉残留绿边。 */
  edgeShrink: number;

  /** 整图行序。 */
  rowOrder: string[];
  rowOrderVersion: number;

  /** 并发请求数（生图 / 视频 / 抽帧各自受限）。 */
  concurrency: number;

  /**
   * ── 渠道层 ──
   *
   * U1 期间这三项与上面的扁平字段**互为投影**（见 docs/渠道层与设置页改造方案.md §9.4）：
   * 旧设置页只写扁平字段，所以写完必须重算默认渠道；新 RPC 只写渠道，所以写完必须回写扁平。
   */
  channels: Record<string, ChannelConfig>;
  suppliers: Record<string, SupplierConfig>;
  bind: BindConfig;
  /** 密钥字典，**键是供应商 id**。永不回传浏览器（`maskConfig` 显式剔除）。 */
  channelSecrets: Record<string, string>;
  /** 渠道层结构版本；缺省即触发一次迁移。 */
  channelVersion: number;
}

export const DEFAULT_CONFIG: Config = {
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

function asInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** 扁平字段那一组（不含渠道层）。迁移与投影都在这两半之间搬。 */
export type FlatConfig = Omit<Config, "channels" | "suppliers" | "bind" | "channelSecrets" | "channelVersion">;

/** 读成普通对象（数组、null、标量一律当空对象）。 */
function asDict(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** 渠道 / 供应商 id 的规范。 */
function isChannelId(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,39}$/.test(value);
}

/** 协议 id 必须落在注册表里——协议错会让整条渠道发错形状，所以宁可丢掉整条渠道。 */
export function isProtocolId(value: string): boolean {
  return listImageInstances().some((item) => item.id === value) || listVideoInstances().some((item) => item.id === value);
}

function normalizeModelEntry(value: unknown): ModelEntry | undefined {
  if (typeof value === "string") {
    const id = value.trim();
    return id === "" ? undefined : { id };
  }
  const raw = asDict(value);
  const id = asString(raw.id, "").trim();
  if (id === "") return undefined;
  const label = asString(raw.label, "").trim();
  return label === "" ? { id } : { id, label: label.slice(0, 60) };
}

function normalizeChannel(id: string, value: unknown): ChannelConfig | undefined {
  const raw = asDict(value);
  const protocol = asString(raw.protocol, "").trim();
  if (!isProtocolId(protocol)) return undefined;
  const baseUrl = asString(raw.baseUrl, "").trim().replace(/\/+$/, "");
  if (baseUrl === "") return undefined;
  const models: ModelEntry[] = [];
  for (const item of asList(raw.models)) {
    const entry = normalizeModelEntry(item);
    if (entry !== undefined && !models.some((model) => model.id === entry.id)) models.push(entry);
  }
  if (models.length === 0) return undefined;
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
function normalizeSlot(value: unknown, suppliers: Record<string, SupplierConfig>): BindSlot {
  const raw = asDict(value);
  const supplierId = asString(raw.supplierId, "").trim();
  if (supplierId === "" || suppliers[supplierId] === undefined) return { supplierId: "" };
  const model = asString(raw.model, "").trim();
  return model === "" ? { supplierId } : { supplierId, model };
}

/**
 * 渠道层归一化。
 *
 * 和上面那组扁平字段一样是**逐字段重建**，所以新增字段必须显式列进这里——
 * 漏一个就等于「用户下次保存任意设置时把它清空」。
 */
function normalizeChannelLayer(
  raw: Record<string, unknown>
): Pick<Config, "channels" | "suppliers" | "bind" | "channelSecrets"> {
  const channels: Record<string, ChannelConfig> = {};
  for (const [id, value] of Object.entries(asDict(raw.channels))) {
    if (!isChannelId(id)) continue;
    const channel = normalizeChannel(id, value);
    if (channel !== undefined) channels[id] = channel;
  }

  const suppliers: Record<string, SupplierConfig> = {};
  for (const [id, value] of Object.entries(asDict(raw.suppliers))) {
    if (!isChannelId(id)) continue;
    const record = asDict(value);
    const channelId = asString(record.channelId, "").trim();
    if (channels[channelId] === undefined) continue; // 悬空引用 → 丢弃该供应商
    suppliers[id] = { name: (asString(record.name, "").trim() || id).slice(0, 80), channelId };
  }

  const bind = emptyBindConfig();
  const rawBind = asDict(raw.bind);
  const rawImage = asDict(rawBind.image);
  bind.image.default = normalizeSlot(rawImage.default, suppliers);
  bind.image.sheet = normalizeSlot(rawImage.sheet, suppliers);
  bind.image.redraw = normalizeSlot(rawImage.redraw, suppliers);
  bind.video.default = normalizeSlot(asDict(rawBind.video).default, suppliers);

  const channelSecrets: Record<string, string> = {};
  for (const [id, value] of Object.entries(asDict(raw.channelSecrets))) {
    if (suppliers[id] === undefined) continue; // 密钥只对存在的供应商有意义
    if (typeof value === "string" && value.trim() !== "") channelSecrets[id] = value;
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
function migrateFlatToChannels(flat: FlatConfig): Pick<Config, "channels" | "suppliers" | "bind" | "channelSecrets"> {
  const channels: Record<string, ChannelConfig> = {};
  const suppliers: Record<string, SupplierConfig> = {};
  const channelSecrets: Record<string, string> = {};
  const bind = emptyBindConfig();

  const redraw = flat.arkRedrawModel.trim();
  const imageModels: ModelEntry[] = [{ id: flat.arkModel }];
  if (redraw !== "" && redraw !== flat.arkModel) imageModels.push({ id: redraw });

  channels["ark-cn"] = {
    protocol: "ark",
    name: "火山方舟",
    baseUrl: flat.arkBaseUrl,
    models: imageModels,
    options: { size: flat.arkSize, watermark: flat.arkWatermark, timeoutMs: flat.arkTimeoutMs }
  };
  suppliers["ark-main"] = { name: "默认账号", channelId: "ark-cn" };
  if (flat.arkApiKey.trim() !== "") channelSecrets["ark-main"] = flat.arkApiKey;
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
  if (flat.minimaxApiKey.trim() !== "") channelSecrets["mm-main"] = flat.minimaxApiKey;
  bind.video.default = { supplierId: "mm-main" };

  return { channels, suppliers, bind, channelSecrets };
}

/** 把任意读入的 JSON 收敛成一份合法配置，缺项一律回落默认值。 */
export function normalizeConfig(input: unknown): Config {
  const raw = (input ?? {}) as Record<string, unknown>;
  const rowOrderRaw = Array.isArray(raw.rowOrder) ? raw.rowOrder.filter((k): k is string => typeof k === "string") : [];
  // 一次性迁移：只有「没有版本号」的旧配置才会被迁到罗盘顺序。
  const needsOrderMigration = raw.rowOrderVersion === undefined && isLegacyRowOrder(rowOrderRaw);
  const rowOrder =
    rowOrderRaw.length === 0 || needsOrderMigration ? [...DEFAULT_ROW_ORDER] : rowOrderRaw;
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

  const flat: FlatConfig = {
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
  const channelLayer =
    raw.channelVersion === undefined && Object.keys(layer.channels).length === 0
      ? migrateFlatToChannels(flat)
      : layer;

  return { ...flat, ...channelLayer, channelVersion: CHANNEL_VERSION };
}

let cache: Config | undefined;

export async function loadConfig(): Promise<Config> {
  if (cache !== undefined) return cache;
  try {
    const text = await readFile(configPath(), "utf8");
    cache = normalizeConfig(JSON.parse(text));
  } catch {
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
export function projectFlatToChannels(config: Config): Config {
  const channels = { ...config.channels };
  const suppliers = { ...config.suppliers };
  const channelSecrets = { ...config.channelSecrets };
  const bind: BindConfig = { image: { ...config.bind.image }, video: { ...config.bind.video } };

  // ── 生图组 ──
  const imageSupplierId = bind.image.default.supplierId || IMAGE_DEFAULT_SUPPLIER;
  const imageChannelId = suppliers[imageSupplierId]?.channelId || IMAGE_DEFAULT_CHANNEL;
  const imageModels: ModelEntry[] = [{ id: config.arkModel }];
  const redraw = config.arkRedrawModel.trim();
  if (redraw !== "" && redraw !== config.arkModel) imageModels.push({ id: redraw });
  channels[imageChannelId] = {
    protocol: channels[imageChannelId]?.protocol ?? "ark",
    name: channels[imageChannelId]?.name ?? "火山方舟",
    baseUrl: config.arkBaseUrl,
    models: imageModels,
    options: { size: config.arkSize, watermark: config.arkWatermark, timeoutMs: config.arkTimeoutMs }
  };
  suppliers[imageSupplierId] = { name: suppliers[imageSupplierId]?.name ?? "默认账号", channelId: imageChannelId };
  if (config.arkApiKey.trim() !== "") channelSecrets[imageSupplierId] = config.arkApiKey;
  else delete channelSecrets[imageSupplierId];
  bind.image.default = { supplierId: imageSupplierId };
  if (bind.image.sheet.supplierId === "") bind.image.sheet = { supplierId: imageSupplierId };
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
  if (config.minimaxApiKey.trim() !== "") channelSecrets[videoSupplierId] = config.minimaxApiKey;
  else delete channelSecrets[videoSupplierId];
  bind.video.default = { supplierId: videoSupplierId };

  return { ...config, channels, suppliers, bind, channelSecrets };
}

/** 渠道层 → 扁平字段（新 RPC 写完走这一步）。 */
export function projectChannelsToFlat(config: Config): Config {
  const imageSlot = config.bind.image.default;
  const videoSlot = config.bind.video.default;
  const imageSupplier = config.suppliers[imageSlot.supplierId];
  const videoSupplier = config.suppliers[videoSlot.supplierId];
  const imageChannel = imageSupplier === undefined ? undefined : config.channels[imageSupplier.channelId];
  const videoChannel = videoSupplier === undefined ? undefined : config.channels[videoSupplier.channelId];
  const imageOptions = imageChannel?.options ?? {};
  const videoOptions = videoChannel?.options ?? {};
  const num = (value: unknown, fallback: number): number =>
    typeof value === "number" && Number.isFinite(value) ? value : fallback;

  return {
    ...config,
    // 只有绑到东西时才回写，否则保留原状（渠道全空时不该把扁平字段清成默认值）。
    ...(imageChannel === undefined
      ? {}
      : {
          arkBaseUrl: imageChannel.baseUrl,
          arkModel: imageSlot.model ?? imageChannel.models[0]?.id ?? config.arkModel,
          arkRedrawModel:
            config.bind.image.redraw.model ??
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
          minimaxResolution:
            typeof videoOptions.resolution === "string" ? videoOptions.resolution : config.minimaxResolution,
          minimaxPromptOptimizer:
            typeof videoOptions.promptOptimizer === "boolean"
              ? videoOptions.promptOptimizer
              : config.minimaxPromptOptimizer,
          minimaxTimeoutMs: num(videoOptions.timeoutMs, config.minimaxTimeoutMs)
        }),
    ...(videoSupplier === undefined ? {} : { minimaxApiKey: config.channelSecrets[videoSlot.supplierId] ?? "" })
  };
}

/** 渠道层的四个键；`saveConfig` 用它判断「这次写的是哪一边」。 */
const CHANNEL_LAYER_KEYS = ["channels", "suppliers", "bind", "channelSecrets"] as const;

export async function saveConfig(patch: Partial<Config>): Promise<Config> {
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

/**
 * 回传给浏览器的脱敏视图。
 *
 * 渠道层这四项**整组排除**，由 `decorateConfig` 重新装配成界面要的形状：
 * `channelSecrets` 是密钥本体（`...rest` 会把它整个 spread 出去）；`channels` / `suppliers` /
 * `bind` 要带上 `keySet` / `keyHint` / 标签，不能直接透传内部结构。
 */
export interface ConfigView
  extends Omit<Config, "arkApiKey" | "minimaxApiKey" | "channelSecrets" | "channels" | "suppliers" | "bind"> {
  arkApiKeySet: boolean;
  arkApiKeyHint: string;
  minimaxApiKeySet: boolean;
  minimaxApiKeyHint: string;
}

export function maskConfig(config: Config): ConfigView {
  const {
    arkApiKey,
    minimaxApiKey,
    channelSecrets: _channelSecrets,
    channels: _channels,
    suppliers: _suppliers,
    bind: _bind,
    ...rest
  } = config;
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
export function hintOf(key: string): string {
  const trimmed = key.trim();
  if (trimmed === "") return "";
  if (trimmed.length <= 8) return "已配置";
  return `…${trimmed.slice(-4)}`;
}
