import assert from "node:assert/strict";
import test from "node:test";
import { mockDiskInspectionSource } from "../mocks/mock-disk-inspection-source.js";

test("Mock DiskInspectionSource 提供首个磁盘告警场景的固定证据", async () => {
  const diskUsage = await mockDiskInspectionSource.getDiskUsage("node-01");
  const rootEntries = await mockDiskInspectionSource.listLargeDirectories("node-01", "/");
  const varEntries = await mockDiskInspectionSource.listLargeDirectories("node-01", "/var");
  const logEntries = await mockDiskInspectionSource.listLargeDirectories("node-01", "/var/log");
  const file = await mockDiskInspectionSource.inspectFile("node-01", "/var/log/app.log");

  assert.equal(diskUsage.filesystems[0]?.usagePercent, 95);
  assert.deepEqual(rootEntries.entries[0], {
    path: "/var",
    sizeGb: 72,
    kind: "directory",
    inspectable: true,
  });
  assert.equal(varEntries.entries[0]?.path, "/var/log");
  assert.equal(logEntries.entries[0]?.path, "/var/log/app.log");
  assert.equal(logEntries.entries[0]?.kind, "file");
  assert.equal(file.sizeGb, 61);
  assert.ok(file.observations.includes("文件仍在持续写入"));
});

test("Mock DiskInspectionSource 拒绝场景外的节点、目录和文件", async () => {
  await assert.rejects(mockDiskInspectionSource.getDiskUsage("node-02"), /Mock 数据不支持节点/);
  await assert.rejects(
    mockDiskInspectionSource.listLargeDirectories("node-01", "/unknown"),
    /不支持检查路径/,
  );
  await assert.rejects(
    mockDiskInspectionSource.inspectFile("node-01", "/etc/passwd"),
    /不支持检查文件/,
  );
});
