using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Microsoft.Win32;

namespace YtDlpStudio;

internal static class Program
{
    public static readonly string Root = Path.TrimEndingDirectorySeparator(AppContext.BaseDirectory);
    public static readonly string Data = Path.Combine(Root, "data");
    public static readonly string SessionFile = Path.Combine(Data, "desktop-session.json");

    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        using var instance = SingleInstance.TryAcquire();
        if (instance == null)
        {
            MessageBox.Show("yt-dlp Studio 已在运行，本次启动已取消。\n请从任务栏或系统托盘打开已有窗口。",
                "软件已在运行", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }
        Directory.CreateDirectory(Data);
        try
        {
            using var window = new StudioWindow();
            Application.Run(window);
        }
        catch (Exception error)
        {
            File.WriteAllText(Path.Combine(Data, "desktop-error.log"), error.ToString());
            MessageBox.Show(error.Message, "无法启动 yt-dlp Studio", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        finally
        {
            if (File.Exists(SessionFile)) File.Delete(SessionFile);
        }
    }
}

internal sealed class StudioWindow : Form
{
    private readonly WebView2 web = new() { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.White };
    private readonly Label loading = new() { Text = "正在启动…", Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleCenter };
    private readonly NotifyIcon tray;
    private readonly ContextMenuStrip menu = new();
    private readonly HttpClient http = new(new HttpClientHandler { UseProxy = false }) { Timeout = TimeSpan.FromSeconds(3) };
    private Icon trayIcon;
    private Process? backend;
    private string origin = "";
    private string token = "";
    private bool ready;
    private bool quitting;
    private bool exiting;
    private bool lightTray;
    private string windowTheme = "light";
    private FormWindowState previousState = FormWindowState.Normal;

    public StudioWindow()
    {
        Text = "yt-dlp Studio";
        ClientSize = new Size(1280, 850);
        MinimumSize = new Size(960, 680);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.White;
        Icon = Icon.ExtractAssociatedIcon(Environment.ProcessPath!)!;
        Controls.Add(web);
        Controls.Add(loading);
        lightTray = IsLightTaskbar();
        trayIcon = DownloadIcon(lightTray ? Color.FromArgb(35, 39, 46) : Color.White);
        menu.Items.Add("打开控制台", null, (_, _) => RestoreWindow());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("退出", null, async (_, _) => await ExitFromTray());
        tray = new NotifyIcon { Icon = trayIcon, Text = "yt-dlp Studio", ContextMenuStrip = menu, Visible = true };
        tray.MouseClick += (_, e) => { if (e.Button == MouseButtons.Left) RestoreWindow(); };
        Shown += async (_, _) => await StartDesktop();
        Resize += (_, _) =>
        {
            if (WindowState == FormWindowState.Minimized) Hide();
            else previousState = WindowState;
        };
        FormClosing += (_, e) =>
        {
            if (!quitting && e.CloseReason == CloseReason.UserClosing) { e.Cancel = true; Hide(); }
        };
        SystemEvents.UserPreferenceChanged += ThemeChanged;
        try
        {
            using var saved = JsonDocument.Parse(File.ReadAllText(Path.Combine(Program.Data, "settings.json")));
            if (saved.RootElement.TryGetProperty("theme", out var theme)) windowTheme = theme.GetString() ?? "light";
        }
        catch (IOException) { }
        catch (JsonException) { }
        ApplyWindowTheme(windowTheme);
        Activated += (_, _) => ApplyWindowTheme(windowTheme);
        WriteSession("starting");
    }

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);

    private void ApplyWindowTheme(string theme)
    {
        windowTheme = theme is "dark" or "sand" or "forest" ? theme : "light";
        var (background, foreground) = windowTheme switch
        {
            "dark" => (Color.FromArgb(23, 28, 36), Color.FromArgb(237, 241, 247)),
            "sand" => (Color.FromArgb(246, 241, 232), Color.FromArgb(64, 55, 45)),
            "forest" => (Color.FromArgb(240, 245, 241), Color.FromArgb(41, 62, 51)),
            _ => (Color.White, Color.FromArgb(36, 42, 51))
        };
        BackColor = loading.BackColor = web.DefaultBackgroundColor = background;
        loading.ForeColor = foreground;
        if (!OperatingSystem.IsWindowsVersionAtLeast(10, 0, 22000)) return;
        // Keep native dragging, resizing and caption buttons, with no contrasting frame.
        var dark = windowTheme == "dark" ? 1 : 0;
        var border = unchecked((int)0xfffffffe); // DWMWA_COLOR_NONE
        var caption = ColorTranslator.ToWin32(background);
        var text = ColorTranslator.ToWin32(foreground);
        DwmSetWindowAttribute(Handle, 20, ref dark, sizeof(int));
        DwmSetWindowAttribute(Handle, 34, ref border, sizeof(int));
        DwmSetWindowAttribute(Handle, 35, ref caption, sizeof(int));
        DwmSetWindowAttribute(Handle, 36, ref text, sizeof(int));
    }

    public void RestoreWindow()
    {
        Show();
        if (WindowState == FormWindowState.Minimized) WindowState = previousState;
        Activate();
        BringToFront();
    }

    private async Task StartDesktop()
    {
        try
        {
            await EnsureBackend();
            var environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(Program.Data, "webview"));
            await web.EnsureCoreWebView2Async(environment);
            var core = web.CoreWebView2;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsZoomControlEnabled = false;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.AreDevToolsEnabled = false;
            core.NavigationStarting += (_, e) =>
            {
                if (!IsLocalPage(e.Uri)) e.Cancel = true;
            };
            core.NewWindowRequested += (_, e) =>
            {
                e.Handled = true;
                if (e.IsUserInitiated && Uri.TryCreate(e.Uri, UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https")
                    Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
            };
            core.PermissionRequested += (_, e) =>
            {
                e.State = IsLocalPage(e.Uri) && e.IsUserInitiated && e.PermissionKind == CoreWebView2PermissionKind.ClipboardRead
                    ? CoreWebView2PermissionState.Allow : CoreWebView2PermissionState.Deny;
            };
            core.WebMessageReceived += OnWebMessage;
            core.NavigationCompleted += (_, e) =>
            {
                if (e.IsSuccess) { loading.Visible = false; ready = true; WriteSession("ready"); }
                else loading.Text = "界面加载失败，请退出后重新打开。";
            };
            core.Navigate(origin);
        }
        catch (Exception error)
        {
            File.WriteAllText(Path.Combine(Program.Data, "desktop-error.log"), error.ToString());
            loading.Text = "启动失败";
            var message = error is WebView2RuntimeNotFoundException
                ? "需要安装 Microsoft Edge WebView2 Runtime。安装后重新打开应用。\nhttps://go.microsoft.com/fwlink/p/?LinkId=2124703"
                : error.Message;
            MessageBox.Show(this, message, "无法启动", MessageBoxButtons.OK, MessageBoxIcon.Error);
            // Do not leave a hidden backend behind when desktop initialization failed.
            if (backend != null)
                try { await ShutdownBackend(); } catch { }
            quitting = true;
            Close();
        }
    }

    private bool IsLocalPage(string address) => Uri.TryCreate(address, UriKind.Absolute, out var uri)
        && uri.GetLeftPart(UriPartial.Authority) == origin;

    private async Task<bool> TryAttach(int port)
    {
        try
        {
            using var response = await http.GetAsync($"http://127.0.0.1:{port}/api/bootstrap");
            if (!response.IsSuccessStatusCode) return false;
            using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            var value = json.RootElement;
            var root = value.GetProperty("environment").GetProperty("root").GetString();
            if (root == null || !string.Equals(Path.TrimEndingDirectorySeparator(Path.GetFullPath(root)), Program.Root, StringComparison.OrdinalIgnoreCase)) return false;
            token = value.GetProperty("token").GetString()!;
            origin = $"http://127.0.0.1:{port}";
            return true;
        }
        catch { return false; }
    }

    private async Task EnsureBackend()
    {
        var portFile = Path.Combine(Program.Data, "desktop-port.txt");
        var preferred = 47831;
        if (File.Exists(portFile) && int.TryParse(File.ReadAllText(portFile), out var saved) && saved is >= 1024 and <= 65535)
            preferred = saved;
        if (await TryAttach(preferred)) return;
        if (preferred != 47831 && await TryAttach(47831)) return;

        var node = Path.Combine(Program.Root, "bin", "node.exe");
        if (!File.Exists(node))
        {
            var dependencies = Path.Combine(Program.Root, "dependencies.json");
            if (File.Exists(dependencies))
            {
                using var config = JsonDocument.Parse(File.ReadAllText(dependencies));
                if (config.RootElement.TryGetProperty("node", out var configured)) node = configured.GetString() ?? node;
            }
        }
        if (!Path.IsPathFullyQualified(node) || !File.Exists(node))
            throw new FileNotFoundException("未找到 Node.js。请重新运行安装程序检查并修复组件，或完整解压便携版。");
        for (var attempt = 0; attempt < 10; attempt++)
        {
            var port = preferred + attempt;
            if (port > 65535) port = 47831 + attempt;
            if (!PortAvailable(port)) continue;
            var start = new ProcessStartInfo(node) { WorkingDirectory = Program.Root, UseShellExecute = false, CreateNoWindow = true };
            start.ArgumentList.Add(Path.Combine(Program.Root, "server.mjs"));
            start.Environment["PORT"] = port.ToString();
            start.Environment["YTDLP_NO_TRAY"] = "1";
            start.Environment["YTDLP_DATA_DIR"] = Program.Data;
            backend = Process.Start(start) ?? throw new InvalidOperationException("无法启动下载服务。");
            for (var retry = 0; retry < 40; retry++)
            {
                if (await TryAttach(port))
                {
                    File.WriteAllText(portFile, port.ToString());
                    return;
                }
                if (backend.HasExited) break;
                await Task.Delay(200);
            }
            if (!backend.HasExited)
                throw new InvalidOperationException("下载服务未响应，请检查 data 目录是否可写。");
            backend.Dispose();
            backend = null;
        }
        throw new InvalidOperationException("无法启动本机下载服务，请检查端口或重新打开应用。");
    }

    private static bool PortAvailable(int port)
    {
        try
        {
            var listener = new TcpListener(IPAddress.Loopback, port);
            listener.Start();
            listener.Stop();
            return true;
        }
        catch (SocketException) { return false; }
    }

    private async void OnWebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (!IsLocalPage(e.Source)) return;
        string? id = null;
        try
        {
            using var json = JsonDocument.Parse(e.WebMessageAsJson);
            if (json.RootElement.TryGetProperty("method", out var operation) && operation.GetString() == "theme")
            {
                ApplyWindowTheme(json.RootElement.GetProperty("theme").GetString() ?? "light");
                return;
            }
            id = json.RootElement.GetProperty("id").GetString();
            if (string.IsNullOrEmpty(id) || id.Length > 80) return;
            var method = json.RootElement.GetProperty("method").GetString();
            switch (method)
            {
                case "pick-folder":
                    using (var dialog = new FolderBrowserDialog { Description = "选择下载保存位置", UseDescriptionForTitle = true, ShowNewFolderButton = true })
                    {
                        var selected = dialog.ShowDialog(this) == DialogResult.OK ? dialog.SelectedPath : null;
                        Reply(id, new { path = selected });
                    }
                    break;
                case "shutdown":
                    if (exiting) throw new InvalidOperationException("正在退出…");
                    exiting = true;
                    try
                    {
                        await ShutdownBackend();
                        Reply(id, new { ok = true });
                        quitting = true;
                        Close();
                    }
                    finally { exiting = false; }
                    break;
                default: throw new InvalidOperationException("不支持此操作。");
            }
        }
        catch (Exception error) { if (id != null && !IsDisposed) Reply(id, null, error.Message); }
    }

    private void Reply(string id, object? result, string? error = null) =>
        web.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new { id, result, error }));

    private async Task ShutdownBackend()
    {
        if (string.IsNullOrEmpty(origin)) return;
        // Refresh the token if a developer restarted the local service.
        if (!await TryAttach(new Uri(origin).Port)) return;
        using var request = new HttpRequestMessage(HttpMethod.Post, origin + "/api/shutdown") { Content = JsonContent.Create(new { }) };
        request.Headers.Add("X-App-Token", token);
        using var response = await http.SendAsync(request);
        if (!response.IsSuccessStatusCode)
        {
            using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            throw new InvalidOperationException(json.RootElement.GetProperty("error").GetString() ?? "无法退出后台。");
        }
    }

    private async Task ExitFromTray()
    {
        if (exiting) return;
        exiting = true;
        try
        {
            if (!ready && origin.Length == 0) throw new InvalidOperationException("正在启动，请稍后再试。");
            await ShutdownBackend();
            quitting = true;
            Close();
        }
        catch (Exception error)
        {
            tray.ShowBalloonTip(4000, "暂时无法退出", error.Message, ToolTipIcon.Info);
        }
        finally { exiting = false; }
    }

    private void WriteSession(string state) => File.WriteAllText(Program.SessionFile,
        JsonSerializer.Serialize(new { pid = Environment.ProcessId, window = Handle.ToInt64(), origin, state }));

    private static bool IsLightTaskbar()
    {
        using var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
        return key?.GetValue("SystemUsesLightTheme") is int value && value == 1;
    }

    private void ThemeChanged(object sender, UserPreferenceChangedEventArgs e)
    {
        if (IsDisposed) return;
        try
        {
            BeginInvoke(() =>
            {
                var light = IsLightTaskbar();
                if (light == lightTray) return;
                lightTray = light;
                var old = trayIcon;
                trayIcon = DownloadIcon(light ? Color.FromArgb(35, 39, 46) : Color.White);
                tray.Icon = trayIcon;
                old.Dispose();
            });
        }
        catch (InvalidOperationException) { }
    }

    [DllImport("user32.dll")] private static extern bool DestroyIcon(IntPtr icon);
    private static Icon DownloadIcon(Color color)
    {
        using var bitmap = new Bitmap(32, 32);
        using var graphics = Graphics.FromImage(bitmap);
        graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
        using var pen = new Pen(color, 3) { StartCap = System.Drawing.Drawing2D.LineCap.Round, EndCap = System.Drawing.Drawing2D.LineCap.Round, LineJoin = System.Drawing.Drawing2D.LineJoin.Round };
        graphics.DrawLine(pen, 16, 4, 16, 21);
        graphics.DrawLines(pen, new[] { new Point(9, 14), new Point(16, 21), new Point(23, 14) });
        graphics.DrawLines(pen, new[] { new Point(5, 23), new Point(5, 28), new Point(27, 28), new Point(27, 23) });
        var handle = bitmap.GetHicon();
        try { using var borrowed = Icon.FromHandle(handle); return (Icon)borrowed.Clone(); }
        finally { DestroyIcon(handle); }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            SystemEvents.UserPreferenceChanged -= ThemeChanged;
            tray.Visible = false;
            tray.Dispose();
            trayIcon.Dispose();
            menu.Dispose();
            web.Dispose();
            backend?.Dispose();
            http.Dispose();
        }
        base.Dispose(disposing);
    }
}
