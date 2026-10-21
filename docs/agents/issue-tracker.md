# Issue tracker: GitHub

任务和规格保存在SEVEN-TSY/chi-etf-monitor的GitHub Issues中，使用gh CLI操作。

## 常用操作

- 创建：gh issue create --title "标题" --body-file <正文文件>
- 读取：gh issue view <编号> --json number,title,body,labels,comments
- 列表：gh issue list --state open --json number,title,body,labels
- 评论：gh issue comment <编号> --body-file <正文文件>
- 添加标签：gh issue edit <编号> --add-label "<标签>"
- 移除标签：gh issue edit <编号> --remove-label "<标签>"
- 关闭：gh issue close <编号>

多行正文写入临时文件后使用--body-file。仓库由origin自动识别。

## Pull requests as a triage surface

PRs as a request surface: no.

## 技能指令映射

- “发布到任务跟踪器”：创建GitHub Issue。
- “获取相关任务”：读取对应Issue。
- 状态标签遵循triage-labels.md。

## Wayfinding

- 用带wayfinder:map标签的Issue保存地图。
- 子任务关联为地图的sub-issue；无法关联时在正文记录Part of #<地图编号>。
- 子任务类型使用wayfinder:research、wayfinder:prototype、
  wayfinder:grilling或wayfinder:task标签。
- 阻塞关系优先使用GitHub原生依赖；无法使用时记录Blocked by: #<编号>。
- 按地图顺序选择开放、无未完成阻塞项且无人认领的任务。
- 开始工作前将任务指派给自己。
- 完成后评论结果、关闭任务，并将结论和链接追加到地图。
