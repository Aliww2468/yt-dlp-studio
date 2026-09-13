# 第三方组件说明

本文说明 yt-dlp Studio 使用的第三方组件、来源及随仓库提供的许可证文件。它不替代各组件的原始许可证文本。

[返回项目首页](../README.md)

## 1. 发行方式与适用范围

v1.1.1 便携版包含 .NET、Node.js、yt-dlp、FFmpeg 和 FFprobe；普通安装版使用精简桌面程序，在安装时复用或下载所需组件。WebView2 Runtime 使用系统安装的版本。

下表中的版本记录主要对应本项目已制作的便携发行包。普通安装版可能复用用户已有版本，或根据安装时的发布元数据下载兼容版本，因此实际运行版本可能不同。下载工具版本可在应用设置中查看。

## 2. 组件及文件

| 组件 | 构建记录或用途 | 来源 | 本地说明文件 |
| --- | --- | --- | --- |
| Node.js | v24.21.0；提供后台及 JavaScript 运行时 | [Node.js 源码](https://github.com/nodejs/node/tree/v24.21.0) | [Node-LICENSE.txt](Node-LICENSE.txt) |
| .NET | .NET 8；提供 Windows 桌面运行时 | [.NET Runtime](https://github.com/dotnet/runtime) | [DotNet-LICENSE.txt](DotNet-LICENSE.txt) |
| Microsoft WebView2 SDK | 桌面项目引用版本 1.0.4191.47 | [NuGet 包](https://www.nuget.org/packages/Microsoft.Web.WebView2/1.0.4191.47) | [WebView2-LICENSE.txt](WebView2-LICENSE.txt) |
| yt-dlp | 2026.08.19；解析与下载 | [对应版本源码](https://github.com/yt-dlp/yt-dlp/tree/2026.08.19) | [yt-dlp-LICENSE.txt](yt-dlp-LICENSE.txt) |
| FFmpeg 与 FFprobe | N-126504-g1b8a2b690b-20260911；媒体处理和检查 | [构建项目](https://github.com/yt-dlp/FFmpeg-Builds) | [FFmpeg-GPLv3.txt](FFmpeg-GPLv3.txt)、[FFmpeg-build.txt](FFmpeg-build.txt) |

FFmpeg 对应源码记录为 [FFmpeg 提交 1b8a2b690b](https://github.com/FFmpeg/FFmpeg/tree/1b8a2b690b)。构建选项及库版本保存在 FFmpeg-build.txt，构建脚本和依赖配方由 FFmpeg-Builds 项目提供。

yt-dlp 独立可执行文件的分发信息及附带依赖说明，见其[对应 Release](https://github.com/yt-dlp/yt-dlp/releases/tag/2026.08.19)。Node.js 许可证文件包含其运行时及相关依赖的声明。

## 3. 系统运行时

Microsoft Edge WebView2 Runtime 不是 yt-dlp Studio 自有代码，也不是 Edge 浏览器本身的替代名称。其部署方式见 [Microsoft 官方说明](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)。

普通安装器会按需调用 Microsoft 提供的运行时安装程序。安装后系统组件的维护、更新及许可说明以相应发布方为准。

## 4. 文档与许可证边界

中文使用说明、架构文档及本文件可以为阅读提供索引，但不改写第三方许可证条款。仓库中的许可证原文应保持其原始内容。

本仓库目前没有针对 GUI 自有源码的独立 LICENSE 文件。公开源码的项目状态与第三方组件各自的许可范围应分别确认；本文件不为 GUI 自有源码补设许可证。

## 5. 维护要求

变更发行包所使用的组件版本、架构或构建来源时，应同步核对：

1. 实际打包文件与版本记录。
2. 相应许可证和附加声明。
3. FFmpeg 构建信息及来源链接。
4. 安装器下载校验方式。
5. Release 中的系统要求和组件说明。

不应只更新表格中的版本号，而继续分发来源或配置不明的旧二进制文件。
