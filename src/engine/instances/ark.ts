/**
 * 火山方舟（Seedream）作为「生图能力」的一个实例。
 *
 * 这里**只做形状转换**：把 engine 的通用请求翻译成 `../../ark.ts` 需要的形状，
 * 再把结果翻译回来。请求体、鉴权、`output_format` 只给 5.0 系列发之类的协议细节
 * 一律留在 ark.ts 里，本文件不复制任何逻辑——所以 ark.ts 可以原样不动。
 */

import { generateImage, testArk, type ArkResult } from "../../ark.js";
import type { CapabilityDescriptor, CatalogEntry, ImageInstance, ImageResult, InstanceContext } from "../types.js";

/** ark.ts 明确接受的尺寸档位；也接受显式 `宽x高`。 */
const ARK_SIZES = ["1K", "2K", "4K"];

/**
 * 可选模型目录。原先放在 config.ts，现在归实例所有——「这家厂商有哪些模型」
 * 是实例的知识，不是全局配置的一部分。
 */
const ARK_MODEL_PRESETS: readonly CatalogEntry[] = [
  { id: "doubao-seedream-4-0-250828", label: "Seedream 4.0（通用、支持图组）" },
  { id: "doubao-seedream-4-5-251128", label: "Seedream 4.5" },
  { id: "doubao-seedream-5-0-260128", label: "Seedream 5.0 Lite（支持 PNG 输出）" },
  { id: "doubao-seedream-5-0-pro-260628", label: "Seedream 5.0 Pro（单图质量最好）" }
];

const CAPABILITY: CapabilityDescriptor = {
  sizes: ARK_SIZES,
  maxRefs: 10,
  supportsWatermark: true,
  async: false
};

export const arkImageInstance: ImageInstance = {
  kind: "image",
  id: "ark",
  label: "火山方舟 Seedream",

  capabilityOf: () => CAPABILITY,

  modelCatalog: () => ARK_MODEL_PRESETS,

  async generate(ctx: InstanceContext, req, signal): Promise<ImageResult> {
    // 模型可以在请求里单指（部件重绘就靠这个换模型）；否则用渠道默认。
    const result: ArkResult = await generateImage(
      {
        baseUrl: ctx.baseUrl,
        apiKey: ctx.apiKey,
        model: req.model ?? ctx.model,
        prompt: req.prompt,
        images: req.images ?? [],
        size: req.size ?? String(ctx.options?.size ?? "2K"),
        watermark: req.watermark ?? ctx.options?.watermark === true,
        timeoutMs: ctx.timeoutMs
      },
      signal
    );
    return { bytes: result.bytes, ext: result.ext, remoteUrl: result.remoteUrl, usage: result.usage };
  },

  test: (ctx) =>
    testArk({
      baseUrl: ctx.baseUrl,
      apiKey: ctx.apiKey,
      model: ctx.model,
      timeoutMs: ctx.timeoutMs
    })
};
