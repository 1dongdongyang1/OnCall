import type { Sop, SopSource } from "../data-sources/sop-source.js";

type MockSop = Sop & {
  keywords: string[];
};

const sops: MockSop[] = [
  {
    id: "SOP-GPU-XID-79",
    title: "GPU Xid 79：GPU 从 PCIe 总线掉线",
    keywords: ["xid 79", "xid79", "fallen off the bus", "gpu 掉线"],
    steps: [
      "停止向故障 GPU 调度新的任务，并记录节点名、GPU UUID 和发生时间。",
      "采集 nvidia-smi、dmesg 中的 NVRM/Xid 日志以及 PCIe 链路状态。",
      "检查供电、温度和 PCIe 连接；不要直接清除现场日志。",
      "在业务已迁移且证据已保存后，按变更流程重启节点。",
      "若重启后复现，隔离节点并升级给硬件团队处理。",
    ],
  },
  {
    id: "SOP-GPU-OVERHEAT",
    title: "GPU 温度过高",
    keywords: ["overheat", "temperature", "高温", "过热"],
    steps: [
      "降低或迁移当前负载。",
      "检查风扇、风道、环境温度和功耗限制。",
      "持续采集温度；温度仍上升时隔离节点并升级处理。",
    ],
  },
];

export const mockSopSource: SopSource = {
  findByQuery: async (query) => {
    const normalizedQuery = query.toLowerCase();
    const match = sops.find((sop) =>
      sop.keywords.some((keyword) => normalizedQuery.includes(keyword)),
    );

    if (!match) {
      return null;
    }

    return {
      id: match.id,
      title: match.title,
      steps: [...match.steps],
    };
  },
};
