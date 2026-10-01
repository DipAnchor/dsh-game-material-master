/**
 * MiniMax 作为「图生视频能力」的一个实例。
 *
 * 同样只做形状转换：v1/v2 双协议、优云智算网关、参数按模型收敛，全部复用
 * `../../minimax.ts` 已有的实现（它本来就带了 `capabilityOf` / `normalizeDuration` /
 * `normalizeResolution`），本文件不重写。
 *
 * `fetch` 把原先散在三处的「成功之后怎么拿到视频」收敛成一处：
 * v2 直接给 `content.url`，v1 得先拿 `file_id` 换一次下载地址。
 */

import {
  COMP_SHARE_BASE_URL,
  COMP_SHARE_MODEL_ID,
  MiniMaxError,
  capabilityOf,
  downloadVideo,
  gatewayOf,
  normalizeDuration,
  normalizeResolution,
  pathPrefixOf,
  queryVideo,
  retrieveFile,
  rootOf,
  submitVideo,
  testMiniMax
} from "../../minimax.js";
import type {
  CapabilityDescriptor,
  CatalogEntry,
  InstanceContext,
  VideoEndpoint,
  VideoInstance,
  VideoParams
} from "../types.js";

/** 可选主机：官方国际站 / 国内站。优云智算网关不在这里——它由模型决定。 */
const MINIMAX_HOST_PRESETS: readonly CatalogEntry[] = [
  { id: "https://api.minimaxi.com", label: "国际站 api.minimaxi.com" },
  { id: "https://api.minimax.cn", label: "国内站 api.minimax.cn" }
];

/**
 * 视频模型下拉。优云智算版 H3 与官方 H3 是同一个模型，只是走第三方网关，
 * 所以做成一个独立的可选项——由用户显式选择，而不是从 Base URL / Key 前缀去猜。
 */
const MINIMAX_MODEL_PRESETS: readonly CatalogEntry[] = [
  { id: "MiniMax-H3", label: "MiniMax-H3（v2 · 768P/2K · 4~15 秒，推荐）" },
  { id: COMP_SHARE_MODEL_ID, label: "优云智算网关 · 768P/1080P/2K · 4~30 秒" },
  { id: "MiniMax-H3-Max", label: "MiniMax-H3-Max（v2 极速 · 480P/768P · 5~15 秒）" },
  { id: "MiniMax-Hailuo-02", label: "MiniMax-Hailuo-02（v1 · 6/10 秒）" },
  { id: "I2V-01-Director", label: "I2V-01-Director（v1 · 支持运镜指令）" },
  { id: "I2V-01", label: "I2V-01（v1）" },
  { id: "I2V-01-live", label: "I2V-01-live（v1）" }
];

export const minimaxVideoInstance: VideoInstance = {
  kind: "video",
  id: "minimax",
  label: "MiniMax",

  capabilityOf(model: string): CapabilityDescriptor {
    const capability = capabilityOf(model);
    return {
      protocol: capability.protocol,
      resolutions: capability.resolutions,
      durations: capability.durations,
      durationMin: capability.durationMin,
      durationMax: capability.durationMax,
      async: true,
      note: capability.note
    };
  },

  normalizeParams(model: string, params: VideoParams): { duration: number; resolution: string } {
    return {
      duration: normalizeDuration(model, params.duration),
      resolution: normalizeResolution(model, params.resolution)
    };
  },

  normalizeBaseUrl: (url: string) => rootOf(url),

  endpointOf(model: string, baseUrl: string): VideoEndpoint {
    return { baseUrl: gatewayOf(model, baseUrl), pathPrefix: pathPrefixOf(model) };
  },

  modelCatalog: () => MINIMAX_MODEL_PRESETS,
  hostCatalog: () => MINIMAX_HOST_PRESETS,
  gatewayVariant: () => ({ modelId: COMP_SHARE_MODEL_ID, baseUrl: COMP_SHARE_BASE_URL }),

  submit(ctx: InstanceContext, req): Promise<string> {
    const model = req.model ?? ctx.model;
    return submitVideo({
      baseUrl: ctx.baseUrl,
      apiKey: ctx.apiKey,
      model,
      timeoutMs: ctx.timeoutMs,
      prompt: req.prompt,
      firstFrameImage: req.firstFrameImage,
      lastFrameImage: req.lastFrameImage,
      referenceImages: req.referenceImages,
      referenceVideos: req.referenceVideos,
      ratio: req.ratio,
      // 时长 / 分辨率仍然按模型能力收敛一次：调用方可能传来旧档位（换过模型之后）。
      duration: req.duration === undefined ? undefined : normalizeDuration(model, req.duration),
      resolution: req.resolution === undefined ? undefined : normalizeResolution(model, req.resolution),
      promptOptimizer: req.promptOptimizer
    });
  },

  query: (ctx: InstanceContext, taskId: string) =>
    queryVideo({
      baseUrl: ctx.baseUrl,
      apiKey: ctx.apiKey,
      model: ctx.model,
      timeoutMs: ctx.timeoutMs,
      taskId
    }),

  async fetch(ctx: InstanceContext, query): Promise<Buffer> {
    const url =
      query.videoUrl ??
      (query.fileId !== undefined
        ? await retrieveFile({
            baseUrl: ctx.baseUrl,
            apiKey: ctx.apiKey,
            model: ctx.model,
            timeoutMs: ctx.timeoutMs,
            fileId: query.fileId
          })
        : undefined);
    if (url === undefined) throw new MiniMaxError("任务已成功，但响应里既没有视频地址也没有 file_id");
    return downloadVideo(url, ctx.timeoutMs);
  },

  test: (ctx: InstanceContext) =>
    testMiniMax({
      baseUrl: ctx.baseUrl,
      apiKey: ctx.apiKey,
      model: ctx.model,
      timeoutMs: ctx.timeoutMs
    })
};
