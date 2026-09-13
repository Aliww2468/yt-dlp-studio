# yt-dlp Studio

一个中文、本机运行的 yt-dlp GUI。四种可选主题、独立高级选项页，不需要注册账户。

## 下载与安装

从 [Releases](https://github.com/Aliww2468/yt-dlp-studio/releases/latest) 下载 Windows x64 版本：

- **Setup.exe**：轻量联网安装器，不内置 .NET、Node.js、yt-dlp、FFmpeg 等前置组件。安装时检查并复用系统中可用的组件，缺少时从官方来源下载，显示检查结果和下载进度。创建开始菜单快捷方式，可从 Windows 设置卸载。卸载保留下载文件、个人设置及系统共享组件。
- **portable.zip**：自带 .NET、Node.js、yt-dlp、FFmpeg 和 FFprobe，完整解压到可写目录后运行；仍使用系统 WebView2 Runtime。

适用于 Windows 10/11 x64。校验值见 SHA256SUMS.txt。安装器需要联网补齐缺少的组件；安装 .NET 等系统组件时 Windows 可能请求管理员授权，取消或下载失败后可重新运行安装器重试。

## 启动

双击 **yt-dlp Studio.exe**。原来的 **启动.vbs** 和 **启动.cmd** 也使用同一启动检查。

这是 Windows x64 桌面应用，使用独立桌面窗口，无需打开浏览器或命令行。需系统已安装 Microsoft Edge WebView2 Runtime。复制到其他电脑时请保留整个软件目录，不要只复制 EXE；目录需要有写入权限。缺少 WebView2 时可从 [Microsoft 官方页面](https://developer.microsoft.com/microsoft-edge/webview2/) 安装 Evergreen Runtime。

- 重复启动 EXE：提示「软件已在运行」并取消本次启动；不再打开第二个窗口或后台。同一 Windows 登录会话中的安装版、便携版及不同目录共用单实例锁。已有窗口可从任务栏或托盘打开。
- 最小化或点击关闭：收起到托盘，下载继续运行。
- 托盘左键单击 / 右键「打开控制台」：恢复同一个窗口。
- 托盘右键「退出」或设置里的「退出应用」：关闭窗口、托盘和下载后台；任务正在下载、排队、解析或更新时会提示先结束操作。

托盘为透明背景的下载箭头，随任务栏明暗主题调整颜色。Windows 可能将新图标放进隐藏图标区域（↑）。本机后台默认使用 127.0.0.1:47831；如果同目录后台已启动，会直接复用。

便携版的下载组件位于 bin 目录。安装版优先复用 bin 中的组件、上次记录的有效路径及系统 PATH 中的兼容组件；Node.js 要求 22+ x64，FFmpeg 和 FFprobe 必须为同目录的一对可运行程序。已复用的路径记录在 dependencies.json，启动时直接使用，避免重新打开后找不到组件。系统组件被卸载或移动后，可重新运行安装器修复。应用内更新系统共享的 yt-dlp 时，会下载软件专用版本到 bin，不修改原来的共享程序。缺失时运行 **安装下载组件.cmd**，从 yt-dlp 官方 GitHub Releases 获取 yt-dlp.exe，以及 yt-dlp/FFmpeg-Builds 提供的 FFmpeg 和 FFprobe。

## 四个页面

| 页面 | 功能 |
| --- | --- |
| 新建下载 | 粘贴链接、解析标题和可用画质、下载视频或音频、选择画质/格式/保存位置；每次最多 50 个链接 |
| 下载列表 | 顺序队列、实际进度/速度/剩余时间、取消与重试、输出目录、原始日志、任务筛选和历史记录 |
| 高级选项 | 总开关、播放列表范围、人工/自动字幕、字幕嵌入、封面、元数据、限速、分片并发、代理、浏览器 Cookie、重试次数 |
| 设置 | 主题风格、紧凑列表、默认目录、组件版本检查、更新 yt-dlp、退出后台 |

高级选项默认关闭。开启时的参数只用于随后添加的任务，已入队任务保留自己的设置。设置和历史记录保存在本机 data 目录。视频/音频的格式选择保留在当前页面会话中。

默认下载目录为项目中的 downloads，可直接输入绝对路径，也可点击「更改」调用 Windows 文件夹选择器。

关闭软件窗口后，后台下载继续运行。彻底退出请用 **设置 → 退出应用**，有下载、解析或更新正在进行时会提示先结束。意外关闭后台后，未完成任务在下次启动时标为「已中断」，可手动重试；断点续传取决于原站支持。移除记录仅移除历史记录，不删除文件。

## 画质、格式与兼容性

- 画质选项是分辨率上限，不会把低清视频升为高清。源站没有提供分辨率的直链仍允许下载。
- MP4 模式优先 H.264/AAC，按需要合并或重新封装；不会强制将所有视频重编码，最终编码取决于可用音源/视频源。
- 音频转换支持 MP3、M4A、FLAC、WAV。无损输出不会提高原始有损音源的质量。
- 播放列表进度显示当前文件的进度；音轨和视频分别下载时百分比可能重新开始，后续显示「正在处理」，只有进程成功结束才显示完成。
- 读取浏览器 Cookie 需在高级选项中主动选择浏览器。现代浏览器的加密、数据库占用或站点验证可能使读取失败；没有默认读取浏览记录或 Cookie。
- 站点支持由 yt-dlp 决定；YouTube/Bilibili 等站点的登录、网络、字幕和播放列表行为需要针对实际链接验证。遇到解析问题可先在设置中更新 yt-dlp。

## 性能与本机边界

桌面外壳使用 .NET 8 WinForms 和系统 WebView2，界面使用 HTML/CSS/JavaScript，后台仅使用 Node.js 内置模块。没有 Electron 或前端框架；WebView2 仍会产生多个渲染进程并占用内存。托盘与窗口由同一个桌面进程管理。

主题可选简约白、午夜黑、暖沙、雾松绿，默认简约白。在设置中点击预览卡片即时切换并自动保存，所有页面共用配色。已移除毛玻璃开关与背景模糊。空闲时不轮询任务列表；通过本机事件流推送任务变化，20 秒发送一次连接心跳。下载进度最多每半秒产生一次输出；任务默认逐个执行。

服务只监听 127.0.0.1，检查 Host / Origin，写入接口需要当前会话令牌。下载引擎使用独立参数数组启动，不执行用户输入的 shell 命令，也不加载外部 yt-dlp 配置/插件。记录、代理设置和任务日志存放在本机；不要把 data 目录作为公开附件分享。

## 开发与验证

```powershell
npm.cmd start
npm.cmd test
```

桌面构建：安装 .NET 8 SDK 和 Node.js 后运行 powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-desktop.ps1，生成根目录的 EXE 并复制 Node.js 到 bin。首次构建会还原 WebView2 NuGet 包。npm start 仅用于开发调试旧的本机网页入口。

后台无需 npm install。集成测试要求 bin 中已有 yt-dlp.exe / ffmpeg.exe / ffprobe.exe。测试会生成短视频并启动独立的本机媒体服务和测试后台（47839 端口），输出保存在 test-output-* 目录，和用户下载目录隔离。

2026-09-13 验证：13 项自动检查通过，覆盖链接/参数验证、本机接口访问保护、真实视频解析与 MP4 下载、真实 MP3 转换并用 FFprobe 检查、已传输数据后的取消和重试、HTTP 404 错误提示、设置和历史记录跨进程重启保留、移除记录保留文件，以及托盘自动启动、单实例、随后台退出清理和下载中阻止退出。托盘菜单尚未完成实际鼠标交互验证。

还通过浏览器实际点击验证了页面切换、高级总开关，以及「输入链接 → 解析 → 下载 → 完成」流程。测试文件由本机生成；不代表已验证所有第三方视频站点。桌面版已实际打开并取消 Windows 文件夹对话框；浏览器 Cookie 和远程站点字幕尚未完成实际交互测试。

## Windows 桌面版验证

2026-09-13：Release 自包含 EXE 发布成功，无编译警告；13 项后台自动检查通过。通过实际 Windows 窗口验证了界面加载、原生文件夹选择器打开和取消、重复启动复用同一 PID/窗口、关闭后隐藏并恢复原窗口，以及设置里的退出操作同时结束窗口和后台。随后从 EXE 冷启动成功，后台使用软件自带的 bin/node.exe，没有旧托盘辅助进程。

桌面托盘左键和右键菜单均绑定到同一个窗口的恢复方法；系统任务栏上的实际鼠标点击尚未完成自动化验证。不同电脑的部署和未安装 WebView2 的场景尚未实机验证。

## 参考

- [yt-dlp 官方项目与参数说明](https://github.com/yt-dlp/yt-dlp)
- [FFmpeg 构建](https://github.com/yt-dlp/FFmpeg-Builds)
- [JavaScript 运行时说明](https://github.com/yt-dlp/yt-dlp/wiki/EJS)

该 GUI 是独立的本地项目，不是 yt-dlp 官方图形客户端。第三方可执行文件遵循各自的许可证。

## 制作发行包

安装 .NET 8 SDK，准备好 bin 中的便携版组件后运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-release.ps1
```

构建分别发布自带运行时的便携版和依赖系统 .NET Desktop 8 x64 的安装版，输出在 release/<版本>/。安装器仅打包界面、后端源码和依赖检测脚本，不包含下载引擎或运行时。

只检查环境（不下载、不安装、不修改配置）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ensure-dependencies.ps1 -CheckOnly
```

依赖下载使用 HTTPS，Node.js、yt-dlp、FFmpeg、.NET 文件校验对应发布方提供的散列值；执行 Microsoft 组件安装器前验证签名。WebView2 按 [Microsoft 官方部署说明](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution) 检测并安装。首次安装在组件齐全时不请求下载；组件不足时磁盘占用取决于需补齐的组件，轻量安装包不等于运行时无需这些组件。