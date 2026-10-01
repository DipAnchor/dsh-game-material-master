/**
 * 生成能力层（engine）的契约。
 *
 * 这一层只认识**能力**，不认识厂商：
 *
 *   - `image` 面负责「给提示词（可选参考图）→ 拿到图片字节」；
 *   - `video` 面负责「提交 → 轮询 → 取件」。
 *
 * 具体怎么发请求、怎么整形参数、各家有哪些协议怪癖（v1/v2、优云智算网关、
 * Seedream 5.0 的 output_format…），全部留在实例里——见 `./instances/`。
 * 调用方只认上面两种能力，所以新增一家厂商＝新增一个实例并登记，
 * 不必回头改 pipeline / imagegen / seqgen / riggen。
 */

/** 一次调用的接入上下文：地址、密钥、默认模型、超时。 */
export interface InstanceContext {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  /**
   * 实例私有的其余渠道参数（例如方舟的 `size` / `watermark`）。
   * 放这里是为了让调用方不必每次都从 config 里挑字段重述一遍。
   */
  options?: Record<string, unknown>;
}

/**
 * 能力描述。用于驱动设置页可选档位、以及提交前的参数收敛——
 * 没有它就只能靠「填了但没用」的输入框去猜。
 */
export interface CapabilityDescriptor {
  /** 生图尺寸档位（`2K` / `1K` / `4K`，或显式 `宽x高`）。 */
  sizes?: string[];
  /** 视频分辨率档位。 */
  resolutions?: string[];
  /** 定值时长档位；给了它就不用 durationMin/durationMax。 */
  durations?: number[];
  durationMin?: number;
  durationMax?: number;
  /** 最多接受几张参考图；0 表示不支持参考图。 */
  maxRefs?: number;
  supportsWatermark?: boolean;
  /** true = 提交/轮询型（视频，以及 ComfyUI 那类异步生图）。 */
  async: boolean;
  /** 一句话说明，可直接显示在下拉标签里。 */
  note?: string;
}

export interface ImageRequest {
  prompt: string;
  /** 参考图 data URI；空数组或不传 = 纯文生图。 */
  images?: string[];
  /** 覆盖渠道默认模型（例如骨骼动画的「部件重绘」用它单指一个模型）。 */
  model?: string;
  size?: string;
  watermark?: boolean;
}

export interface ImageResult {
  bytes: Buffer;
  /** 落盘用的扩展名，由实际内容嗅探得到。 */
  ext: string;
  remoteUrl?: string;
  usage?: unknown;
}

/** 生图实例：文生图 / 图生图走同一条 `generate`。 */
export interface ImageInstance {
  readonly kind: "image";
  readonly id: string;
  readonly label: string;
  capabilityOf(model: string): CapabilityDescriptor;
  generate(ctx: InstanceContext, req: ImageRequest, signal?: AbortSignal): Promise<ImageResult>;
  test(ctx: InstanceContext): Promise<{ ok: true; model: string; bytes: number; ext: string }>;
}

export interface VideoRequest {
  prompt: string;
  /** 首帧 / 尾帧；与参考图、参考视频互斥（平台规定）。 */
  firstFrameImage?: string;
  lastFrameImage?: string;
  referenceImages?: string[];
  referenceVideos?: string[];
  ratio?: string;
  duration?: number;
  resolution?: string;
  promptOptimizer?: boolean;
  model?: string;
}

export type VideoTaskStatus = "pending" | "running" | "succeeded" | "failed";

export interface VideoQuery {
  status: VideoTaskStatus;
  /** 远端原始状态字符串，用于界面展示。 */
  remoteStatus: string;
  error?: string;
  /** 部分协议成功时给的是 file_id，需要再换一次下载地址。 */
  fileId?: string;
  /** 部分协议成功时直接给视频地址。 */
  videoUrl?: string;
  raw?: unknown;
}

/** 视频实例：提交与轮询分开，因为一段视频要几分钟、而且八段要并发提交统一轮询。 */
export interface VideoInstance {
  readonly kind: "video";
  readonly id: string;
  readonly label: string;
  capabilityOf(model: string): CapabilityDescriptor;
  submit(ctx: InstanceContext, req: VideoRequest): Promise<string>;
  query(ctx: InstanceContext, taskId: string): Promise<VideoQuery>;
  /** 取回视频字节；实例内部负责「file_id 换下载地址」那一步。 */
  fetch(ctx: InstanceContext, query: VideoQuery): Promise<Buffer>;
  test(ctx: InstanceContext): Promise<{ ok: true; model: string }>;
}
