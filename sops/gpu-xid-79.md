---
id: SOP-GPU-XID-79
keywords: xid 79, xid79, fallen off the bus, gpu 掉线
---

# GPU Xid 79：GPU 从 PCIe 总线掉线

## 处理步骤

1. 停止向故障 GPU 调度新的任务，并记录节点名、GPU UUID 和发生时间。
2. 采集 nvidia-smi、dmesg 中的 NVRM/Xid 日志以及 PCIe 链路状态。
3. 检查供电、温度和 PCIe 连接；不要直接清除现场日志。
4. 在业务已迁移且证据已保存后，按变更流程重启节点。
5. 若重启后复现，隔离节点并升级给硬件团队处理。
