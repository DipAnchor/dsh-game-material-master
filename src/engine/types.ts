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
  /**
   * 该模型走的线上协议（例如 MiniMax 的 `v1` / `v2`）。
   * 界面要显示它，排错时也靠它区分「模型不对」和「协议不对」。
   */
  protocol?: string;
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

/** 下拉里的一个可选项：`id` 是真正写进配置的值，`label` 是显示文案。 */
export interface CatalogEntry {
  id: string;
  label: string;
}

/**
 * 视频参数。存储与提交都要按模型收敛，所以单独抽出来。
 *
 * 入参刻意是 `unknown`：这三个调用点面对的是配置文件内容与界面输入，
 * 可能是数字、字符串或空值，收敛逻辑本来就负责把它们兜住。
 */
export interface VideoParams {
  duration?: unknown;
  resolution?: unknown;
}

/** 某个模型实际会用的端点。第三方网关会覆盖主机并追加协议前缀。 */
export interface VideoEndpoint {
  /** 主机根，不含 `/v1`、`/v2`。 */
  baseUrl: string;
  /** 协议路径前缀（优云智算网关是 `/minimax`）。 */
  pathPrefix: string;
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
  /** 该实例对外提供的模型目录，界面下拉直接用。 */
  modelCatalog(): readonly CatalogEntry[];
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
  /**
   * 按模型能力收敛时长 / 分辨率：入参可以是脏的（配置文件里的原始值），
   * 出参一定是合法值。存储与提交都要过这一道，否则换模型会留下非法档位。
   */
  normalizeParams(model: string, params: VideoParams): { duration: number; resolution: string };  /** 把用户填的主机地址收敛成主机根（去掉尾斜杠与 `/v1`、`/v2`）。 */
  normalizeBaseUrl(url: string): string;
  /** 该模型实际会用的端点（网关覆盖 + 路径前缀）。 */
  endpointOf(model: string, baseUrl: string): VideoEndpoint;
  /** 该实例对外提供的模型目录。 */
  modelCatalog(): readonly CatalogEntry[];
  /** 该实例可选的主机目录。 */
  hostCatalog(): readonly CatalogEntry[];
  /**
   * 该实例的「网关变体」（若有）：同一个模型走第三方网关时，设置页需要知道
   * 触发它的模型 id 与实际主机。渠道模型落地后，这会退化成一个普通渠道。
   */
  gatewayVariant?(): { modelId: string; baseUrl: string } | undefined;
  submit(ctx: InstanceContext, req: VideoRequest): Promise<string>;
  query(ctx: InstanceContext, taskId: string): Promise<VideoQuery>;
  /** 取回视频字节；实例内部负责「file_id 换下载地址」那一步。 */
  fetch(ctx: InstanceContext, query: VideoQuery): Promise<Buffer>;
  test(ctx: InstanceContext): Promise<{ ok: true; model: string }>;
}
