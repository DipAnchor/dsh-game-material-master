/**
 * engine 门面：调用方唯一需要认识的东西。
 *
 * 用法上就是「按当前配置绑定一次，再调能力」：
 *
 *   const image = imageEngine(config);
 *   const { bytes, ext } = await image.generate({ prompt, images: refs });
 *
 *   const video = videoEngine(config);
 *   const taskId = await video.submit({ prompt, firstFrameImage });
 *   const query = await video.query(taskId);
 *   const bytes = await video.fetch(query);
 *
 * 这一层只做两件事：把配置翻译成实例上下文、把能力转发给实例。厂商名、协议、
 * 参数整形都不在这里——所以调用方以后换成别的生图服务时不用改。
 *
 * P0 阶段每个能力只有唯一实现（方舟 / MiniMax），实例 id 先写死；等渠道配置
 * 落地后改由渠道决定，届时这里会多一个「按 id 选实例」的入参。
 */

import type { BindSlot, Config, ImagePurpose } from "../config.js";
import { imageInstance, listImageInstances, listVideoInstances, videoInstance } from "./registry.js";
import type {
  CapabilityDescriptor,
  CatalogEntry,
  ImageInstance,
  ImageRequest,
  ImageResult,
  InstanceContext,
  VideoEndpoint,
  VideoInstance,
  VideoParams,
  VideoQuery,
  VideoRequest
} from "./types.js";

/** 解析结果：走哪个协议 + 这次调用用的上下文 + 溯源信息（排错与任务快照都用它）。 */
export interface ResolvedTarget {
  protocol: string;
  context: InstanceContext;
  /** 落到哪个供应商与渠道；回落到扁平字段时两者都是空串。 */
  supplierId: string;
  channelId: string;
}

/** 调用的用途。模型可以在这一次调用里换，但用途决定「默认用哪个绑定」。 */
export type { ImagePurpose };

const NO_OPTIONS: Record<string, unknown> = {};

/**
 * 从渠道层解析一次调用。
 *
 * 顺序是 **模型 → 渠道 → 供应商**（见 docs/渠道层与设置页改造方案.md §2.1）：
 * 先定模型，再由模型所在的渠道决定地址与协议，最后由绑定决定用谁的 key。
 *
 * 解析不出来时**回落到扁平字段**。U1 期间两者互为投影（§9.4），所以回落只是兜底——
 * 例如用户把渠道全删了、或配置是从「还没有渠道层」的版本读进来的。
 */
function resolveTarget(
  config: Config,
  slot: BindSlot | undefined,
  override: { supplierId?: string; model?: string } | undefined,
  flat: { protocol: string; baseUrl: string; apiKey: string; model: string; timeoutMs: number; options: Record<string, unknown> }
): ResolvedTarget {
  const supplierId = (override?.supplierId ?? slot?.supplierId ?? "").trim();
  const supplier = supplierId === "" ? undefined : config.suppliers[supplierId];
  const channel = supplier === undefined ? undefined : config.channels[supplier.channelId];
  if (supplier !== undefined && channel !== undefined && channel.models.length > 0) {
    const wanted = (override?.model ?? slot?.model ?? "").trim();
    // 指定了模型就用指定的那一个（不在这里校验它是否在该渠道清单里——那是界面的活）；
    // 没指定才回落到渠道的第一个。这样「任务快照里的模型」不会被静默换掉。
    const model = wanted !== "" ? wanted : channel.models[0]!.id;
    // `timeoutMs` 是上下文的字段，不是实例私有参数，所以从 options 里摘出来。
    const { timeoutMs: channelTimeout, ...instanceOptions } = channel.options ?? NO_OPTIONS;
    return {
      protocol: channel.protocol,
      supplierId,
      channelId: supplier.channelId,
      context: {
        baseUrl: channel.baseUrl,
        apiKey: config.channelSecrets[supplierId] ?? "",
        model,
        timeoutMs:
          typeof channelTimeout === "number" && Number.isFinite(channelTimeout) ? channelTimeout : flat.timeoutMs,
        options: instanceOptions
      }
    };
  }
  return {
    protocol: flat.protocol,
    supplierId: "",
    channelId: "",
    context: { baseUrl: flat.baseUrl, apiKey: flat.apiKey, model: flat.model, timeoutMs: flat.timeoutMs, options: flat.options }
  };
}

/**
 * 解析一次生图调用。
 *
 * `purpose` 决定用哪条绑定：`default` 是常规生图，`sheet` 是骨骼动画的拆件摊平图，
 * `redraw` 是部件重绘（旧配置里它靠 `arkRedrawModel` 单指一个模型）。
 */
export function resolveImageTarget(
  config: Config,
  purpose: ImagePurpose = "default",
  override?: { supplierId?: string; model?: string }
): ResolvedTarget {
  const redraw = config.arkRedrawModel.trim();
  return resolveTarget(config, config.bind.image[purpose], override, {
    protocol: "ark",
    baseUrl: config.arkBaseUrl,
    apiKey: config.arkApiKey,
    model: purpose === "redraw" && redraw !== "" ? redraw : config.arkModel,
    timeoutMs: config.arkTimeoutMs,
    // 尺寸与去水印是渠道级参数，放这里让调用方不必每次重述。
    options: { size: config.arkSize, watermark: config.arkWatermark }
  });
}

/** 解析一次图生视频调用。 */export function resolveVideoTarget(
  config: Config,
  override?: { supplierId?: string; model?: string }
): ResolvedTarget {
  return resolveTarget(config, config.bind.video.default, override, {
    protocol: "minimax",
    baseUrl: config.minimaxBaseUrl,
    apiKey: config.minimaxApiKey,
    model: config.minimaxModel,
    timeoutMs: config.minimaxTimeoutMs,
    options: {
      duration: config.minimaxDuration,
      resolution: config.minimaxResolution,
      promptOptimizer: config.minimaxPromptOptimizer
    }
  });
}

/**
 * 视频渠道的三个参数（时长 / 分辨率 / 提示词优化）。
 *
 * 它们是**渠道级**参数，调用方按用途解析出 target 之后直接取，就不必再回头读扁平字段。
 * 缺省回落到迁移前的全局值（U1 期间两者相等）。
 */
export function videoOptionsOf(
  target: ResolvedTarget,
  config: Config
): { duration: number; resolution: string; promptOptimizer: boolean } {
  const options = target.context.options ?? {};
  return {
    duration: typeof options.duration === "number" ? options.duration : config.minimaxDuration,
    resolution: typeof options.resolution === "string" ? options.resolution : config.minimaxResolution,
    promptOptimizer:
      typeof options.promptOptimizer === "boolean" ? options.promptOptimizer : config.minimaxPromptOptimizer
  };
}

export interface BoundImageEngine {
  readonly instance: ImageInstance;
  generate(req: ImageRequest, signal?: AbortSignal): Promise<ImageResult>;
  test(): Promise<{ ok: true; model: string; bytes: number; ext: string }>;
}

export interface BoundVideoEngine {
  readonly instance: VideoInstance;
  submit(req: VideoRequest): Promise<string>;
  query(taskId: string): Promise<VideoQuery>;
  fetch(query: VideoQuery): Promise<Buffer>;
  test(): Promise<{ ok: true; model: string }>;
}

/**
 * 绑定一个生图实例。
 *
 * 协议由 `target.protocol` 决定用哪个实例——调用方不再需要知道「当前是哪一家」。
 * `overrides` 只用来临时改写上下文字段（目前没有调用方需要）。
 */
export function imageEngine(target: ResolvedTarget, overrides?: Partial<InstanceContext>): BoundImageEngine {
  const ctx: InstanceContext = { ...target.context, ...overrides };
  const instance = imageInstance(target.protocol);
  return {
    instance,
    generate: (req, signal) => instance.generate(ctx, req, signal),
    test: () => instance.test(ctx)
  };
}

/**
 * 绑定一个图生视频实例。
 *
 * 轮询是异步的、可能跨进程重启，调用方需要能从任务自身的快照重建出一致的上下文——
 * 所以这里照样吃一个已解析的 target，而不是原始配置。
 */
export function videoEngine(target: ResolvedTarget, overrides?: Partial<InstanceContext>): BoundVideoEngine {
  const ctx: InstanceContext = { ...target.context, ...overrides };
  const instance = videoInstance(target.protocol);
  return {
    instance,
    submit: (req) => instance.submit(ctx, req),
    query: (taskId) => instance.query(ctx, taskId),
    fetch: (query) => instance.fetch(ctx, query),
    test: () => instance.test(ctx)
  };
}

/**
 * 以下是**厂商无关的能力查询**，一律转发给当前实例。
 *
 * 它们的用途是让 config.ts / 设置页 / seqgen 不必再直接 import 厂商模块：
 * 「这个模型支持哪些档位」「这个值合不合法」「实际会发到哪个地址」都是实例的知识。
 * 这些函数按模型（而不是按配置）取值，所以 config.ts 在读配置、还没组装出完整
 * Config 时也能用。
 */

/** 视频能力：档位、时长区间、协议与说明。 */
export function videoCapabilityOf(model: string): CapabilityDescriptor {
  return defaultVideoInstance().capabilityOf(model);
}

/** 按模型能力收敛时长 / 分辨率：入参可以脏，出参一定合法。 */
export function normalizeVideoParams(
  model: string,
  params: VideoParams
): { duration: number; resolution: string } {
  return defaultVideoInstance().normalizeParams(model, params);
}

/** 把用户填的主机地址收敛成主机根（去掉尾斜杠与 `/v1`、`/v2`）。 */
export function normalizeVideoBaseUrl(url: string): string {
  return defaultVideoInstance().normalizeBaseUrl(url);
}

/** 该模型实际会用的端点（网关覆盖 + 路径前缀）。 */
export function videoEndpointOf(model: string, baseUrl: string): VideoEndpoint {
  return defaultVideoInstance().endpointOf(model, baseUrl);
}

/**
 * 以下是**按模型**（而不是按渠道）查询能力时用的默认实例。
 *
 * 这类查询只拿到模型 id、拿不到渠道，所以推不出协议；每个能力面目前只有一个实例，
 * 取注册表里的第一个即可。等同一能力面出现第二个协议时，这些函数要改成接受协议 id
 * ——调用方那时才有渠道信息。
 */
function defaultImageInstance(): ImageInstance {
  return listImageInstances()[0]!;
}

function defaultVideoInstance(): VideoInstance {
  return listVideoInstances()[0]!;
}

/** 协议目录：供界面生成「接口协议」下拉。 */
export interface ProtocolEntry {
  id: string;
  label: string;
  capability: "image" | "video";
}

export function listProtocols(): readonly ProtocolEntry[] {
  return [
    ...listImageInstances().map((instance) => ({ id: instance.id, label: instance.label, capability: "image" as const })),
    ...listVideoInstances().map((instance) => ({ id: instance.id, label: instance.label, capability: "video" as const }))
  ];
}

/** 某个协议下已知模型的显示名（未知 id 返回 undefined，交给调用方回落）。 */
export function modelLabelOf(protocol: string, model: string): string | undefined {
  const instances = [...listImageInstances(), ...listVideoInstances()];
  const hit = instances.find((instance) => instance.id === protocol);
  return hit?.modelCatalog().find((entry) => entry.id === model)?.label;
}

/** 生图模型目录。 */
export function imageModelCatalog(): readonly CatalogEntry[] {
  return defaultImageInstance().modelCatalog();
}

/** 视频模型目录。 */
export function videoModelCatalog(): readonly CatalogEntry[] {
  return defaultVideoInstance().modelCatalog();
}

/** 视频主机目录。 */
export function videoHostCatalog(): readonly CatalogEntry[] {
  return defaultVideoInstance().hostCatalog();
}

/** 视频实例的网关变体（若有）：触发它的模型 id 与实际主机。 */
export function videoGatewayVariant(): { modelId: string; baseUrl: string } | undefined {
  return defaultVideoInstance().gatewayVariant?.();
}
