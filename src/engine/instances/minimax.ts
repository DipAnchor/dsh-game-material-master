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
  MiniMaxError,
  capabilityOf,
  downloadVideo,
  normalizeDuration,
  normalizeResolution,
  queryVideo,
  retrieveFile,
  submitVideo,
  testMiniMax
} from "../../minimax.js";
import type { CapabilityDescriptor, InstanceContext, VideoInstance } from "../types.js";

export const minimaxVideoInstance: VideoInstance = {
  kind: "video",
  id: "minimax",
  label: "MiniMax",

  capabilityOf(model: string): CapabilityDescriptor {
    const capability = capabilityOf(model);
    return {
      resolutions: capability.resolutions,
      durations: capability.durations,
      durationMin: capability.durationMin,
      durationMax: capability.durationMax,
      async: true,
      note: capability.note
    };
  },

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
