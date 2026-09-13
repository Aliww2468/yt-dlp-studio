# yt-dlp Studio

yt-dlp Studio 是面向 Windows 的中文视频与音频下载桌面应用。项目以 yt-dlp 为下载引擎，提供链接解析、下载队列、媒体格式选择、字幕配置、主题切换及系统托盘等功能。

当前正式版本为 **v1.1.1**。本项目为独立图形客户端，与 yt-dlp 官方项目不存在官方客户端关系。站点解析及媒体提取能力由所使用的 yt-dlp 版本决定。

## 下载

请通过 [GitHub Releases](https://github.com/Aliww2468/yt-dlp-studio/releases/latest) 获取正式发行文件。仓库页面中的 “Code → Download ZIP” 下载的是源代码，不是可直接运行的 Windows 发行包。

| 发行文件 | 适用场景 | 组件提供方式 |
| --- | --- | --- |
| `yt-dlp-Studio-1.1.1-win-x64-Setup.exe` | 在固定电脑上安装使用 | 轻量联网安装器，检查并复用已有组件，缺少时下载 |
| `yt-dlp-Studio-1.1.1-win-x64-portable.zip` | 使用完整目录部署或保存便携副本 | 自带 .NET、Node.js、yt-dlp、FFmpeg 和 FFprobe，使用系统 WebView2 |
| `SHA256SUMS.txt` | 核对下载文件是否完整 | 提供安装包及便携包的 SHA-256 校验值 |

v1.1.1 安装器大小为 521,216 字节，约 509 KiB；便携包大小为 246,502,688 字节，约 235 MiB。安装器体积不包含后续可能需要下载的前置组件。实际新增磁盘占用取决于已有系统环境、缓存及下载内容。

## 系统要求

- Windows 10 或 Windows 11，x64 架构。
- 软件目录及下载目录具有当前用户的写入权限。
- 可以访问目标媒体站点；联网安装时还需访问相关组件的官方分发服务。
- 桌面界面需要 Microsoft Edge WebView2 Runtime。
- 安装版需要 .NET Desktop Runtime 8 x64；安装器会检查并补齐。
- Node.js 要求 22 或以上版本且为 x64；下载任务需要可用的 yt-dlp、FFmpeg 和 FFprobe。

完整的组件检测规则、安装位置及修复方式见[安装、升级与卸载说明](docs/installation.md)。

## 快速开始

1. 下载并运行安装器，或将便携包完整解压至可写目录。
2. 启动 `yt-dlp Studio.exe`。
3. 在“新建下载”页面输入链接，每行一个；一次最多提交 50 个链接。
4. 根据需要解析第一个链接，选择视频或音频模式、画质、格式与保存位置。
5. 单击“开始下载”，在“下载列表”中查看任务进度与处理结果。

关闭或最小化窗口会将应用收起到系统托盘，下载继续执行。完全退出时，请使用托盘菜单“退出”或“设置 → 退出应用”。

同一 Windows 登录会话中，再次启动安装版、便携版或其他目录中的新版本，会提示“软件已在运行，本次启动已取消”。确认提示后，本次启动退出；已有窗口可从任务栏或托盘打开。单实例限制针对应用实例，不代表任务管理器中仅存在一个进程；Node.js、WebView2 及媒体处理工具仍可能作为工作进程运行。

## 功能概览

| 功能范围 | 当前提供的功能 |
| --- | --- |
| 基础下载 | 单链接及多链接提交、视频信息解析、分辨率上限选择、视频与音频输出 |
| 任务管理 | 顺序队列、进度、速度、剩余时间、取消、重试、日志、历史记录 |
| 高级下载 | 播放列表范围、字幕、自动字幕、字幕嵌入、封面、媒体信息、限速、分片并发、代理、浏览器 Cookie |
| 桌面集成 | 独立窗口、系统托盘、跨目录单实例检测、原生文件夹选择器 |
| 外观设置 | 简约白、午夜黑、暖沙、雾松绿，以及紧凑下载列表 |
| 组件维护 | 版本检测、安装时自动补齐依赖、应用内更新 yt-dlp |

## 文档目录

完整文档也可从 [v1.1.1 文档包](https://github.com/Aliww2468/yt-dlp-studio/releases/download/v1.1.1/yt-dlp-Studio-1.1.1-Documentation.zip) 下载。该附件与程序包分开提供，可使用同页的 Documentation-SHA256SUMS.txt 校验。

| 文档 | 内容 |
| --- | --- |
| [安装、升级与卸载](docs/installation.md) | 发行版选择、组件检测、安装流程、校验、修复与迁移 |
| [使用手册](docs/user-guide.md) | 四个页面、任务状态、日常下载、托盘及退出操作 |
| [高级选项参考](docs/advanced-options.md) | 各项配置的默认值、范围、示例及生效条件 |
| [故障排查与常见问题](docs/troubleshooting.md) | 启动、安装、下载、字幕、目录访问与性能问题 |
| [数据与网络说明](docs/data-and-network.md) | 本地文件、依赖路径、备份、网络请求及日志处理 |
| [开发与发行说明](docs/development.md) | 环境准备、源码结构、测试、桌面构建及 GitHub 发布 |
| [架构与接口说明](docs/architecture.md) | 进程职责、单实例机制、桌面通信及本地 HTTP 接口 |
| [验证记录与已知限制](docs/validation.md) | 已执行检查、人工验证及尚未覆盖的场景 |
| [版本记录](CHANGELOG.md) | 各版本的功能与行为变化 |
| [第三方组件说明](licenses/THIRD_PARTY_NOTICES.md) | 组件来源、版本及许可证文件 |

## 从源码运行

面向开发人员的简要入口如下，完整步骤见[开发与发行说明](docs/development.md)。

```powershell
npm.cmd start
npm.cmd test
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/build-desktop.ps1
```

后台仅使用 Node.js 内置模块，无需安装 npm 依赖。桌面构建需要 .NET SDK，并会还原 WebView2 NuGet 包。直接启动后台属于开发运行方式，不等同于正式桌面版的启动流程。

## 反馈

请在 [GitHub Issues](https://github.com/Aliww2468/yt-dlp-studio/issues) 提交问题。建议提供软件版本、Windows 版本、发行版类型、复现步骤及已脱敏的错误信息；具体格式见[故障排查文档](docs/troubleshooting.md)。

文档以当前源码和已执行的验证为依据。软件功能的实现状态与第三方站点的实际可用性分别记录，不将本地测试结果视为所有站点均已验证。

## 项目与组件许可

仓库目前未提供针对 GUI 自有源码的独立 `LICENSE` 文件。第三方组件的许可证文本保存在 [licenses](licenses/) 目录，其来源与适用范围见[第三方组件说明](licenses/THIRD_PARTY_NOTICES.md)。许可证原文不随中文使用说明改写。
