import assert from "node:assert/strict";
import test from "node:test";
import {
  createMockDiskInspectionSource,
  mockDiskInspectionSource,
} from "../mocks/mock-disk-inspection-source.js";

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

test("Mock 场景覆盖告警恢复、备份占用和工具失败", async () => {
  const recovered = createMockDiskInspectionSource("recovered");
  assert.equal(
    (await recovered.getDiskUsage("node-recovered")).filesystems[0]?.usagePercent,
    68,
  );

  const backup = createMockDiskInspectionSource("backup-occupation");
  const backupDirectory = await backup.listLargeDirectories(
    "node-backup",
    "/data/backup",
  );
  assert.equal(backupDirectory.entries[0]?.kind, "file");
  const backupFile = await backup.inspectFile(
    "node-backup",
    "/data/backup/full-20260909.bak",
  );
  assert.equal(backupFile.sizeGb, 166);
  assert.match(backupFile.observations.join(" "), /保留策略/);

  const failing = createMockDiskInspectionSource("directory-tool-failure");
  await assert.rejects(
    failing.listLargeDirectories("node-tool-failure", "/"),
    /Mock 目录检查失败/,
  );
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
