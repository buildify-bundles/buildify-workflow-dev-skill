# Skill 版本与更新

`prepare.mjs` 会顺带检查版本（等同 `node $S/update-check.mjs`），有新版本时输出一行 `Skill: …`。同一次对话只提示一次：

- 「可从 X 更新到 Y」：在第一条回复开头说一句，然后照常编排，不要停下等回答：

  > buildify-workflow-dev 有新版本 {latest}（当前 {current}）：{notes 用「；」连起来}。说「更新 skill」我来更新。

  这次的汇报表最后加一行「Skill 版本」：`{current}，可更新到 {latest}`。
- 「低于最低版本，必须先问用户是否更新」：当前版本太旧，按它编排可能出错。**停止编排**，说明当前版本、最新版本和要点，请用户确认更新；确认后更新再继续，用户坚持不更新就照常编排，汇报里写明版本过旧。
- 没有 `Skill:` 这一行（已是最新、检查失败或跳过）：什么都不说。

**用户说「更新 skill」时：** 跑 `node $S/update-check.mjs --force` 拿到 `skillDir`，按 [install.md](../install.md)「取文件」原地更新（git 仓库 `pull --ff-only`；不是 git 仓库或 pull 失败就先备份再重装），再跑一次 `--force` 确认 `updateAvailable` 为 false。用表格汇报旧版本、新版本和要点，并提醒：新版说明要在**新开的对话**里才生效。当前对话里是否接着编排，由用户决定。不要顺手装别的客户端，也不要改用户的 git 配置。
