# Tools directory / 工具目录

## 中文

在 **集成与外观** 搜索“目录”，填写绝对路径并点“保存工具目录”。这是本机所有项目共用的工具安装根目录，各工具使用独立子目录。保存后会显示反馈；重启服务后设置保留。“恢复默认目录”或留空保存会恢复自动策略：

- Windows 有 D 盘：`D:/DevTools`。
- Windows 没有 D 盘：`%LOCALAPPDATA%/Sonail/tools`；缺少该环境变量时使用用户的 `AppData/Local`。
- 其他系统：`$XDG_DATA_HOME/sonail/tools`，未设置时使用 `~/.local/share/sonail/tools`。

这个目录会送入经理规划、执行者、审查者和经理说明，也出现在复制交接和 AI 项目上下文中。它是安装位置指引，安装和联网仍须遵守项目权限与原有写入范围。保存不会创建目录、安装程序、搬迁现有工具、改变系统 PATH 或中断已发出的调用；新派发使用新设置。当前 harness 继续使用其原生程序发现机制。

## English

Search **tools** in **Integrations & appearance**, enter an absolute path and choose **Save tools directory**. It is a machine-wide root shared by projects, with separate subdirectories per tool. Saving gives feedback and persists across service restarts. **Restore default directory**, or saving blank, restores the policy:

- Windows with drive D: `D:/DevTools`.
- Windows without D: `%LOCALAPPDATA%/Sonail/tools`, falling back to the user's `AppData/Local`.
- Other systems: `$XDG_DATA_HOME/sonail/tools`, or `~/.local/share/sonail/tools` when unset.

The effective path follows manager planning, executor/reviewer/manager instructions, copied handoffs and project-scoped AI context. It guides installation location; existing project permissions and write boundaries still apply. Saving does not create directories, install/move programs, change PATH or interrupt active calls. New dispatches use the new value. Harnesses retain their native executable-discovery mechanism.
