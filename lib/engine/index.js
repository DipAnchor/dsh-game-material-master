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
 * 实例由**渠道的协议**决定：`resolveImageTarget` / `resolveVideoTarget` 把配置解析成
 * 「走哪个协议 + 这次调用用什么上下文」，门面再拿协议 id 去注册表取实例。
 * 所以这里不再有写死的厂商 id。
 */
import { imageInstance, listImageInstances, listVideoInstances, videoInstance } from "./registry.js";
const NO_OPTIONS = {};
/** 渠道没给 `timeoutMs` 时用的兜底（生图/生视频都可能跑几分钟，别设太短）。 */
const DEFAULT_TIMEOUT_MS = 180000;
/**
 * 模型反查渠道（§2.1）。
 *
 * 同一个模型 id 落在**哪条渠道**，就归那条渠道的地址与协议。没有这一步，
 * 「任务里钉住的模型」会被打到另一条渠道的网关上——这就是历史上那个
 * 「任务存官方 H3 + 全局切优云智算 → cp.compshare.cn/v2/... 404」。
 *
 * 优先级：
 *   ① 绑定供应商自己的渠道里就有 → 用它（同 id 出现在多条渠道时，绑定即用户的意图）；
 *   ② 否则找第一条含它的渠道，并挑一个有密钥的供应商——否则解析出来是空 key。
 */
function channelHostingModel(config, model, preferSupplierId) {
    const preferred = preferSupplierId === "" ? undefined : config.suppliers[preferSupplierId];
    if (preferred !== undefined && config.channels[preferred.channelId]?.models.some((entry) => entry.id === model)) {
        return { supplierId: preferSupplierId, channelId: preferred.channelId };
    }
    for (const [channelId, channel] of Object.entries(config.channels)) {
        if (!channel.models.some((entry) => entry.id === model))
            continue;
        const holder = Object.keys(config.suppliers).find((id) => config.suppliers[id].channelId === channelId && (config.channelSecrets[id] ?? "").trim() !== "");
        if (holder !== undefined)
            return { supplierId: holder, channelId };
    }
    return undefined;
}
/**
 * 从渠道层解析一次调用。
 *
 * 顺序是 **模型 → 渠道 → 供应商**（见 docs/渠道层与设置页改造方案.md §2.1）：
 * 先定模型，再由模型所在的渠道决定地址与协议，最后由绑定决定用谁的 key。
 *
 * 解析不出来就**抛错**（U4 之前还能回落到扁平字段，现在没有那层了）。
 * `capability` 只用来把错误消息说得像人话——用户要知道是「生图」还是「部件重绘」没配。
 */
function resolveTarget(config, slot, override, capability) {
    const supplierId = (override?.supplierId ?? slot?.supplierId ?? "").trim();
    const wanted = (override?.model ?? slot?.model ?? "").trim();
    // 模型反查渠道：指定了模型就以它落在哪条渠道为准。
    const hosted = wanted === "" ? undefined : channelHostingModel(config, wanted, supplierId);
    const actualSupplierId = hosted?.supplierId ?? supplierId;
    const supplier = actualSupplierId === "" ? undefined : config.suppliers[actualSupplierId];
    const channel = hosted !== undefined ? config.channels[hosted.channelId] : supplier === undefined ? undefined : config.channels[supplier.channelId];
    if (supplier !== undefined && channel !== undefined && channel.models.length > 0) {
        // 指定了模型就用指定的那一个（不在这里校验它是否在该渠道清单里——那是界面的活）；
        // 没指定才回落到渠道的第一个。这样「任务快照里的模型」不会被静默换掉。
        const model = wanted !== "" ? wanted : channel.models[0].id;
        // `timeoutMs` 是上下文的字段，不是实例私有参数，所以从 options 里摘出来。
        const { timeoutMs: channelTimeout, ...instanceOptions } = channel.options ?? NO_OPTIONS;
        return {
            protocol: channel.protocol,
            supplierId: actualSupplierId,
            channelId: hosted?.channelId ?? supplier.channelId,
            context: {
                baseUrl: channel.baseUrl,
                apiKey: config.channelSecrets[actualSupplierId] ?? "",
                model,
                timeoutMs: typeof channelTimeout === "number" && Number.isFinite(channelTimeout) ? channelTimeout : DEFAULT_TIMEOUT_MS,
                options: instanceOptions
            }
        };
    }
    // U4 之后没有扁平字段可以兜底了：解析不出来就是**配置没配好**，如实报错。
    // 消息要说清「去哪儿配」——这是用户唯一能动手的地方。
    throw new Error(`${capability} 还没有可用的渠道：请在「设置 → 游戏素材大师」里配置一条渠道与一个供应商，` +
        "并把对应的「用途绑定」指过去");
}
/** 没有渠道可解析时抛错用的能力名。 */
function describeCapability(purpose) {
    return purpose === "sheet" ? "拆件生图" : purpose === "redraw" ? "部件重绘" : "生图";
}
/**
 * 解析一次生图调用。
 *
 * `purpose` 决定用哪条绑定：`default` 是常规生图，`sheet` 是骨骼动画的拆件摊平图，
 * `redraw` 是部件重绘。
 */
export function resolveImageTarget(config, purpose = "default", override) {
    return resolveTarget(config, config.bind.image[purpose], override, describeCapability(purpose));
}
/** 解析一次图生视频调用。 */
export function resolveVideoTarget(config, override) {
    return resolveTarget(config, config.bind.video.default, override, "图生视频");
}
/** 渠道没给参数时用的兜底值（正常路径下渠道里都有）。 */
const DEFAULT_VIDEO_DURATION = 5;
const DEFAULT_VIDEO_RESOLUTION = "2K";
/**
 * 视频渠道的三个参数（时长 / 分辨率 / 提示词优化）。
 *
 * 它们是**渠道级**参数，调用方按用途解析出 target 之后直接取；渠道里没写才用兜底值。
 */
export function videoOptionsOf(target) {
    const options = target.context.options ?? {};
    return {
        duration: typeof options.duration === "number" ? options.duration : DEFAULT_VIDEO_DURATION,
        resolution: typeof options.resolution === "string" ? options.resolution : DEFAULT_VIDEO_RESOLUTION,
        promptOptimizer: typeof options.promptOptimizer === "boolean" ? options.promptOptimizer : true
    };
}
/**
 * 绑定一个生图实例。
 *
 * 协议由 `target.protocol` 决定用哪个实例——调用方不再需要知道「当前是哪一家」。
 * `overrides` 只用来临时改写上下文字段（目前没有调用方需要）。
 */
export function imageEngine(target, overrides) {
    const ctx = { ...target.context, ...overrides };
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
export function videoEngine(target, overrides) {
    const ctx = { ...target.context, ...overrides };
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
export function videoCapabilityOf(model) {
    return defaultVideoInstance().capabilityOf(model);
}
/** 按模型能力收敛时长 / 分辨率：入参可以脏，出参一定合法。 */
export function normalizeVideoParams(model, params) {
    return defaultVideoInstance().normalizeParams(model, params);
}
/** 把用户填的主机地址收敛成主机根（去掉尾斜杠与 `/v1`、`/v2`）。 */
export function normalizeVideoBaseUrl(url) {
    return defaultVideoInstance().normalizeBaseUrl(url);
}
/** 该模型实际会用的端点（网关覆盖 + 路径前缀）。 */
export function videoEndpointOf(model, baseUrl) {
    return defaultVideoInstance().endpointOf(model, baseUrl);
}
/**
 * 以下是**按模型**（而不是按渠道）查询能力时用的默认实例。
 *
 * 这类查询只拿到模型 id、拿不到渠道，所以推不出协议；每个能力面目前只有一个实例，
 * 取注册表里的第一个即可。等同一能力面出现第二个协议时，这些函数要改成接受协议 id
 * ——调用方那时才有渠道信息。
 */
function defaultImageInstance() {
    return listImageInstances()[0];
}
function defaultVideoInstance() {
    return listVideoInstances()[0];
}
export function listProtocols() {
    return [
        ...listImageInstances().map((instance) => ({
            id: instance.id,
            label: instance.label,
            capability: "image",
            defaultBaseUrl: instance.defaultBaseUrl,
            hosts: [],
            presets: instance.modelCatalog(),
            probeable: typeof instance.listModels === "function"
        })),
        ...listVideoInstances().map((instance) => ({
            id: instance.id,
            label: instance.label,
            capability: "video",
            defaultBaseUrl: instance.defaultBaseUrl,
            hosts: instance.hostCatalog(),
            presets: instance.modelCatalog(),
            probeable: typeof instance.listModels === "function"
        }))
    ];
}
/** 某个协议的代表性地址：新建渠道预填、`saveChannel` 兜底都用它。 */
export function protocolDefaultBaseUrl(protocol) {
    return listProtocols().find((entry) => entry.id === protocol)?.defaultBaseUrl;
}
/**
 * 让某个协议去探一次模型清单。
 *
 * 协议不存在、或它压根不支持（没实现 `listModels`）时抛错——由调用方翻译成
 * 用户看得懂的话。探测本身失败（Key 不对 / 地址不对）也抛错，界面照原样显示。
 */
export async function probeProtocolModels(protocol, ctx) {
    const image = listImageInstances().find((instance) => instance.id === protocol);
    if (image !== undefined) {
        if (image.listModels === undefined)
            throw new Error(`协议「${image.label}」不支持检测模型清单`);
        return image.listModels(ctx);
    }
    const video = listVideoInstances().find((instance) => instance.id === protocol);
    if (video !== undefined) {
        if (video.listModels === undefined)
            throw new Error(`协议「${video.label}」不支持检测模型清单`);
        return video.listModels(ctx);
    }
    throw new Error(`未知协议：${protocol}`);
}
/** 某个协议下已知模型的显示名（未知 id 返回 undefined，交给调用方回落）。 */
export function modelLabelOf(protocol, model) {
    const instances = [...listImageInstances(), ...listVideoInstances()];
    const hit = instances.find((instance) => instance.id === protocol);
    return hit?.modelCatalog().find((entry) => entry.id === model)?.label;
}
/** 某个协议下某个模型的能力。界面据此决定「渲染哪些控件」——不支持就不渲染。 */
export function modelCapabilityOf(protocol, model) {
    const instances = [...listImageInstances(), ...listVideoInstances()];
    return instances.find((instance) => instance.id === protocol)?.capabilityOf(model);
}
/**
 * 四级回落的前两级：**本次执行 → 任务 / 项目设置**。
 *
 * 后两级（用途绑定 → 渠道第一个模型）由 `resolveTarget` 负责。这里只把前两级
 * 合成一个值，传下去当 `model` 覆盖项——所以调用方不必自己写 `a || b || c`。
 */
export function pickModel(callModel, taskModel) {
    const wanted = (callModel ?? "").trim() || (taskModel ?? "").trim();
    return wanted === "" ? undefined : wanted;
}
/** 生图模型目录。 */
export function imageModelCatalog() {
    return defaultImageInstance().modelCatalog();
}
/** 视频模型目录。 */
export function videoModelCatalog() {
    return defaultVideoInstance().modelCatalog();
}
/** 视频主机目录。 */
export function videoHostCatalog() {
    return defaultVideoInstance().hostCatalog();
}
/** 视频实例的网关变体（若有）：触发它的模型 id 与实际主机。 */
export function videoGatewayVariant() {
    return defaultVideoInstance().gatewayVariant?.();
}
