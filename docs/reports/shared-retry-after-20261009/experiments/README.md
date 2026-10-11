# Standalone 成品尺寸对照补丁

E1–E5 的基线均为 `9c1ed3ccf235ea4e860392bc215258390829a3d1`；每个补丁独立应用，不能串行叠加。E5 包含 E1–E4 的组合。源码仅保留既有能力边界，E1–E5 原 3,600,000 B 验证器均失败。E6 是最终源码 `3618398ba86436938747a32f4072857a9dae4db2`。E7 仅改变该源码的构建期编码器，实际省 60 B，未选入生产。

在包含本报告的干净 checkout 保存报告路径，另开对应基线的 detached worktree，再选择一个补丁。下面完整命令复现 E1；替换 patch 文件名即可复现 E2–E5。

```bash
report_checkout=$(pwd)
git worktree add --detach /tmp/fluentread-budget-e1-20261011 9c1ed3ccf235ea4e860392bc215258390829a3d1
cd /tmp/fluentread-budget-e1-20261011
git apply "$report_checkout/docs/reports/shared-retry-after-20261009/experiments/R1-pako-inflate-entry.patch"
pnpm install --frozen-lockfile
export FLUENTREAD_TEST_CPU_TARGET=60
export FLUENTREAD_TEST_MAX_WORKERS=1
export FLUENTREAD_TEST_CONCURRENCY=1
pnpm test:userscript:standalone
```

E1 的最后命令预期在原尺寸门禁失败；生成产物仍可按根报告中精确字节和 SHA 核对。不要将门禁失败改成成功或沿用其它实验的产物。E7 使用基线 `3618398ba86436938747a32f4072857a9dae4db2` 及 `E7-buildtime-encoder.patch`，并分别执行两种原构建/verifier。实验保持冻结 lock、资源 pin、生成代码目标和预算；没有新依赖或运行时选路接口。构建时长/RSS是单次环境样本，浏览器性能不在这些命令的范围。

两个补丁把空白上下文行编码成相同空行的删除/新增，以免补丁文件自身引入尾随空格；在独立 Git index 中应用后的所有改动文件已逐字节核对实际构建快照，生产改动不变。
