# 官方来源与核实记录

最后人工核实：**2026-08-10**。集群静态分区/费率快照仍以 `references/data/` 内标注的 **2026-08-09** 为准。

## NCSA Delta 官方文档

- Delta User Guide 首页：<https://docs.ncsa.illinois.edu/systems/delta/en/latest/>
- 登录：<https://docs.ncsa.illinois.edu/systems/delta/en/latest/user_guide/login.html>
- 系统架构与节点硬件：<https://docs.ncsa.illinois.edu/systems/delta/en/latest/user_guide/architecture.html>
- 运行作业、分区、interactive、preempt、filesystem constraints：<https://docs.ncsa.illinois.edu/systems/delta/en/latest/user_guide/running_jobs.html>
- 作业计费、`accounts`、`jobcharge`、`QOSGrpBillingMinutes`：<https://docs.ncsa.illinois.edu/systems/delta/en/latest/user_guide/job_accounting.html>
- 数据管理、quota、`/projects`、`/work/hdd`、`/tmp`、Globus：<https://docs.ncsa.illinois.edu/systems/delta/en/latest/user_guide/data_mgmt.html>
- 软件、Lmod、Conda、Apptainer、Jupyter：<https://docs.ncsa.illinois.edu/systems/delta/en/latest/user_guide/software.html>
- Delta 支持：从 User Guide 的 Support 链接进入当前 NCSA 工单系统；不要把旧工单 URL 硬编码进自动化。

登录页当前明确说明：直接 SSH 使用 NCSA 用户名、密码和 NCSA Duo；普通用户的 SSH public-key pair 登录被禁用，Gateway allocation 是需另行批准的例外；首选 round-robin 主机为 `login.delta.ncsa.illinois.edu`，具体节点为 `dt-login01` 至 `dt-login04`。

## Slurm 官方文档

- `sbatch`：<https://slurm.schedmd.com/sbatch.html>
- backfill/scheduling：<https://slurm.schedmd.com/sched_config.html>
- `squeue`：<https://slurm.schedmd.com/squeue.html>
- `sacct`：<https://slurm.schedmd.com/sacct.html>
- priority multifactor：<https://slurm.schedmd.com/priority_multifactor.html>
- job arrays：<https://slurm.schedmd.com/job_array.html>
- quick start：<https://slurm.schedmd.com/quickstart.html>

## OpenAI Codex、Remote Control 与 skill 格式

- OpenAI Remote environments：<https://developers.openai.com/codex/remote-connections/>
- OpenAI Codex CLI：<https://developers.openai.com/codex/cli/>
- OpenAI Build skills：<https://developers.openai.com/codex/build-skills/>

Remote environments 文档是手机到桌面 Remote Control、同一 ChatGPT 账号/workspace、Mac 保持清醒，以及 Desktop SSH host/远端 Codex要求的首要来源。CLI 文档是当前安装和登录命令的首要来源。

当前 skill 格式要点：skill 是包含必需 `SKILL.md` 的目录，可选 `scripts/`、`references/`、`assets/`、`agents/openai.yaml`；`SKILL.md` frontmatter 至少有 `name` 和 `description`。用户级路径是 `$HOME/.agents/skills`，仓库级路径是沿当前目录到仓库根的 `.agents/skills`。

## 已知文档冲突/陈旧点

1. Data Management 页面写 `$HOME` 每日快照保留 30 天；Architecture 页面写 14 天。此技能不依赖固定天数，要求 `ls ~/.snapshot/` 现场查看，且强调快照不是备份。
2. Running Jobs 的文件系统表把 `/projects` 标为 `projects`、`/work/hdd` 标为 `work`，但同页某些示例仍出现旧的 `scratch` 说法。先用 `sinfo ... %f`/`scontrol show node` 验证 feature，不能盲抄旧示例。
3. 某些软件页仍把 `/scratch` 当大配额路径描述；当前 Data Management 把 `/work/hdd` 定义为 scratch/work 区。以 live path、`quota` 和 Data Management 当前表为准。
4. MI100 节点硬件页写有 8×MI100 + 1×MI210，但普通分区名是 `gpuMI100x8`。不要假定第 9 卡对普通 Slurm 作业可申请。
5. 模块、容器镜像、节点数量和费率会变。静态表只能作初始参考。

## 事实优先级

遇到冲突时按以下顺序：

1. 当前 Delta 控制面只读输出：`scontrol`、`sinfo`、`accounts`、`quota`、`sacct`、`jobcharge`；
2. 当前 NCSA Delta 官方文档；
3. 当前 Slurm 官方文档；
4. 本技能静态参考；
5. 旧日志、博客、记忆。

若 live 配置与 NCSA 文档冲突，记录命令、时间、完整输出，并建议向 NCSA 支持确认；不要自行“修正”集群策略。
