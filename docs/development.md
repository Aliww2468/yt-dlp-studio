# 开发与发行说明

适用代码基线：v1.1.1。

[返回项目首页](../README.md) · [架构与接口](architecture.md)

## 1. 开发环境

建议使用 Windows x64 完成桌面构建及验证。主要工具如下：

| 工具 | 用途 |
| --- | --- |
| Node.js 22+ x64 | 本机后台、JavaScript 测试及便携运行时 |
| .NET SDK 8 或兼容 SDK | 构建 net8.0-windows 桌面项目 |
| Windows PowerShell | 组件准备、打包与安装器测试 |
| Windows .NET Framework 编译器 | 编译独立安装器与卸载器 |
| Git | 源码版本管理 |
| GitHub CLI | 需要发布时创建和上传 Release |
| yt-dlp、FFmpeg、FFprobe | 下载功能和真实媒体集成测试 |

后台仅使用 Node.js 内置模块，无需执行 npm install。桌面项目依赖 Microsoft.Web.WebView2 NuGet 包，首次构建需要正常访问包源。

## 2. 获取源码与准备组件

```powershell
git clone https://github.com/Aliww2468/yt-dlp-studio.git
Set-Location yt-dlp-studio
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/setup.ps1
```

setup.ps1 只准备下载组件，不安装 Node.js、.NET 或 WebView2。构建桌面版前，需确认 node.exe 和 dotnet.exe 可通过 PATH 找到。

```powershell
node.exe --version
dotnet.exe --info
```

build-desktop.ps1 会将 PATH 中解析到的 Node.js 复制到项目 bin 目录，因此构建人员应核对所使用运行时的版本与架构。

## 3. 开发运行方式

```powershell
npm.cmd start
```

此命令直接启动 server.mjs。默认监听 127.0.0.1:47831，并可能启用旧的开发用托盘辅助程序。它不经过正式桌面启动器的单实例门禁。

若只需要后台调试，可以在当前 PowerShell 会话中设置：

```powershell
$env:YTDLP_NO_TRAY = '1'
$env:PORT = '47839'
node.exe server.mjs
```

退出调试后，可清除这两个当前会话环境变量，避免影响后续命令：

```powershell
Remove-Item Env:YTDLP_NO_TRAY -ErrorAction SilentlyContinue
Remove-Item Env:PORT -ErrorAction SilentlyContinue
```

正式桌面入口是 yt-dlp Studio.exe。它选择端口、启动或连接对应后台，并创建 WebView2 窗口和托盘。

## 4. 源码目录

| 路径 | 职责 |
| --- | --- |
| desktop/Program.cs | 桌面窗口、WebView2、托盘、后台生命周期和原生操作 |
| desktop/SingleInstance.cs | 当前登录会话中的跨目录实例锁及旧实例检测 |
| desktop/Studio.Desktop.csproj | 桌面目标框架、运行时与 WebView2 依赖 |
| server.mjs | 本机 HTTP 服务、队列、任务持久化与下载工具调度 |
| lib/options.mjs | 链接校验、选项规范化和 yt-dlp 参数生成 |
| lib/dependencies.mjs | 本地及外部下载组件路径选择 |
| lib/appearance.mjs | 主题名称规范化 |
| lib/tray.mjs | 开发后台使用的旧托盘辅助入口 |
| public/ | 界面 HTML、CSS 与 JavaScript |
| scripts/ | 构建、依赖准备、安装器及发行脚本 |
| tests/ | JavaScript、PowerShell 和单实例多进程测试 |
| docs/ | 用户、维护人员及开发人员文档 |
| licenses/ | 第三方组件说明和许可证原文 |

## 5. 自动检查

### 5.1 后台与参数测试

```powershell
npm.cmd test
```

也可以直接使用随项目准备的 Node.js：

```powershell
.\bin\node.exe --test tests/*.test.mjs
```

测试包括真实媒体解析、视频下载、音频转换、取消重试、持久化、本机接口保护、组件路径选择及开发托盘行为。相关检查会生成测试媒体和独立数据目录，不应将测试输出混入用户下载目录。

### 5.2 安装器依赖测试

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests/installer.test.ps1
```

测试先验证本机已有真实组件的复用，再以受控测试数据覆盖缺少组件、重复执行、网络错误和校验失败。当前真实组件复用部分需要测试电脑已具备 .NET Desktop 与 WebView2 等环境，因此并不是任意干净 Windows 机器均可无准备执行的测试。

### 5.3 单实例并发测试

```powershell
dotnet.exe run --project tests/single-instance/SingleInstance.Tests.csproj -c Release
```

此测试使用隔离的测试互斥名称，创建多个工作进程，检查并发启动、正常释放及崩溃后重新获取锁。它不会用测试进程替换正在运行的正式桌面实例。

### 5.4 测试端口

当前集成测试使用 47839，旧托盘测试使用 47841，本地浏览器演示媒体服务使用 47840。执行前应确认这些端口未被其他工作占用。不要在相同端口同时运行多份同类集成测试。

详细的已执行检查与未覆盖场景见[验证记录](validation.md)。

## 6. 构建桌面程序

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/build-desktop.ps1
```

该脚本生成并嵌入下载图标，执行 Release 自包含发布，将主程序复制到源码根目录。输出暂存于 build/desktop。覆盖根目录 EXE 前，应退出正在运行的该副本。

开发时也可以显式构建依赖系统 .NET 的精简桌面程序：

```powershell
dotnet.exe publish desktop/Studio.Desktop.csproj -c Release -o build/desktop-online -p:SelfContained=false -p:PublishSingleFile=true
```

该输出仅是桌面构建结果。要独立运行，还需应用资源、后台源码和可用依赖配置，不能将它直接当作完整发行目录。

## 7. 制作发行包

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/package-release.ps1
```

脚本读取 package.json 中的版本，在 release/<版本>/ 生成：

- 轻量联网 Setup.exe。
- 完整 portable.zip。
- 对应两个文件的 SHA256SUMS.txt。

脚本分别构建自包含和依赖系统运行时的桌面程序，并在 build/package-<随机标识>/ 中暂存文件。便携版从 bin 复制已准备好的下载组件；普通安装器仅打包精简应用及依赖安装逻辑。

为避免覆盖已有发行文件，默认同名文件已存在时脚本会报错。重复验证时可以指定新的输出目录：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/package-release.ps1 -OutputDirectory '.\release\verification-build'
```

当前已发布的 v1.1.1 二进制包只包含当时的简要 README。完整文档通过仓库和独立文档附件提供；如果后续将 docs 目录加入二进制包，应同时检查其相对链接、安装清单和第三方说明路径。

## 8. 版本同步

创建新的程序版本时，应检查以下位置：

| 位置 | 作用 |
| --- | --- |
| package.json | 发行文件命名所用版本 |
| desktop/Studio.Desktop.csproj | 桌面程序集版本 |
| scripts/Installer.cs 中的 Version | Windows 卸载记录中的版本 |
| public/index.html | 界面版本显示，目前采用主次版本形式 |
| CHANGELOG.md 与 README.md | 面向用户的版本与行为说明 |
| licenses/THIRD_PARTY_NOTICES.md | 实际打包组件变化时更新 |

更新文档本身不必虚增程序版本。相同版本已经公开后，应避免直接用内容不同的 EXE 或 ZIP 覆盖原发行资产；补充文档可以作为单独附件提供。

## 9. 发布到 GitHub

以下步骤用于维护人员正式发布已验证的版本，不是安装用户的操作步骤。GitHub CLI 必须具有目标仓库权限。

```powershell
gh auth status
git status
git diff --check
git push origin main
```

在本地文本文件中准备正式发布说明，再通过 --notes-file 传入：

```powershell
gh release create vX.Y.Z <安装器路径> <便携包路径> <校验文件路径> --repo Aliww2468/yt-dlp-studio --target main --title 'yt-dlp Studio vX.Y.Z' --notes-file <发布说明路径> --draft
```

将示例中的版本和路径替换为实际值。上传完成后，应检查资产数量、大小和 GitHub 返回的散列值，再将草稿发布并设置为最新版本。文档调整可以使用 gh release edit --notes-file 更新相应说明。

## 10. 本地文件与仓库边界

bin、data、downloads、build、release、测试输出及桌面编译缓存均不应作为普通源码提交。dependencies.json 包含本机路径，也不应提交。

开发目录可能保留多次打包及验证副本，其总大小不能代表最终安装体积。清理前应分别确认源码、正式发行文件、用户数据与测试产物的范围，避免按名称模糊删除。

Windows PowerShell 5.1 使用的中文脚本应保留 UTF-8 BOM；普通文档使用 UTF-8。修改依赖配置读写时，应显式核对中文路径的编码处理。
