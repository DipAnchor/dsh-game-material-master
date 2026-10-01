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

import type { Config } from "../config.js";
import { imageInstance, videoInstance } from "./registry.js";
import type {
  ImageInstance,
  ImageRequest,
  ImageResult,
  InstanceContext,
  VideoInstance,
  VideoQuery,
  VideoRequest
} from "./types.js";

const IMAGE_INSTANCE_ID = "ark";
const VIDEO_INSTANCE_ID = "minimax";

/** 把生图相关的配置翻译成实例上下文。 */
function imageContext(config: Config): InstanceContext {
  return {
    baseUrl: config.arkBaseUrl,
    apiKey: config.arkApiKey,
    model: config.arkModel,
    timeoutMs: config.arkTimeoutMs,
    // 尺寸与去水印是渠道级参数，放这里让调用方不必每次重述。
    options: { size: config.arkSize, watermark: config.arkWatermark }
  };
}

/** 把图生视频相关的配置翻译成实例上下文。 */
function videoContext(config: Config): InstanceContext {
  return {
    baseUrl: config.minimaxBaseUrl,
    apiKey: config.minimaxApiKey,
    model: config.minimaxModel,
    timeoutMs: config.minimaxTimeoutMs
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
 * `overrides` 用来临时改写上下文——目前只有一个用途：部件重绘要换模型。
 * （按用途换渠道是渠道配置落地后的事。）
 */
export function imageEngine(config: Config, overrides?: Partial<InstanceContext>): BoundImageEngine {
  const ctx: InstanceContext = { ...imageContext(config), ...overrides };
  const instance = imageInstance(IMAGE_INSTANCE_ID);
  return {
    instance,
    generate: (req, signal) => instance.generate(ctx, req, signal),
    test: () => instance.test(ctx)
  };
}

/**
 * 绑定一个图生视频实例。
 *
 * `overrides` 用来临时改写上下文——轮询是异步的、可能跨进程重启，调用方需要能
 * 从任务自身的快照（例如 `job.settings.model`）重建出与提交时一致的上下文。
 */
export function videoEngine(config: Config, overrides?: Partial<InstanceContext>): BoundVideoEngine {
  const ctx: InstanceContext = { ...videoContext(config), ...overrides };
  const instance = videoInstance(VIDEO_INSTANCE_ID);
  return {
    instance,
    submit: (req) => instance.submit(ctx, req),
    query: (taskId) => instance.query(ctx, taskId),
    fetch: (query) => instance.fetch(ctx, query),
    test: () => instance.test(ctx)
  };
}
