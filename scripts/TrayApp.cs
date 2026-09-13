using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

internal static class TrayApp
{
    [STAThread]
    private static int Main(string[] args)
    {
        // No shell, no visible helper window, and no resident PowerShell process.
        if (args.Length != 3) return 2;
        try
        {
            Uri address = new Uri(args[1]);
            if (address.Scheme != "http" || address.Host != "127.0.0.1") return 2;
            Process parent = Process.GetProcessById(Int32.Parse(args[2]));
            if (parent.HasExited) return 0;
            string key;
            using (SHA256 sha = SHA256.Create())
                key = BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(address.AbsoluteUri))).Replace("-", "");
            bool created;
            using (Mutex singleton = new Mutex(true, @"Local\YtDlpStudioTray-" + key, out created))
            {
                if (!created) return 0;
                try
                {
                    Application.EnableVisualStyles();
                    Application.SetCompatibleTextRenderingDefault(false);
                    using (TrayContext tray = new TrayContext(Path.GetFullPath(args[0]), address, parent))
                        Application.Run(tray);
                }
                finally { singleton.ReleaseMutex(); }
            }
            return 0;
        }
        catch (ArgumentException) { return 0; } // Parent exited while the helper was starting.
        catch (Exception ex)
        {
            try { File.AppendAllText(Path.Combine(args[0], "data", "tray-error.log"), DateTime.Now.ToString("s") + " " + ex + Environment.NewLine); } catch { }
            return 1;
        }
    }
}

internal sealed class TrayContext : ApplicationContext
{
    private readonly NotifyIcon tray;
    private readonly ContextMenuStrip menu;
    private readonly ToolStripMenuItem exitItem;
    private readonly System.Windows.Forms.Timer heartbeat;
    private readonly Process parent;
    private readonly string root;
    private readonly Uri address;
    private readonly HttpClient client;
    private readonly JavaScriptSerializer serializer = new JavaScriptSerializer();
    private Icon currentIcon;
    private bool lightTheme;
    private bool disposed;
    private DateTime lastOpen = DateTime.MinValue;

    public TrayContext(string root, Uri address, Process parent)
    {
        this.root = root;
        this.address = address;
        this.parent = parent;
        client = new HttpClient(new HttpClientHandler { UseProxy = false });
        client.BaseAddress = address;
        client.Timeout = TimeSpan.FromSeconds(15);
        serializer.MaxJsonLength = 16 * 1024 * 1024;

        menu = new ContextMenuStrip();
        menu.Items.Add("打开界面", null, delegate { OpenWindow(); });
        menu.Items.Add(new ToolStripSeparator());
        exitItem = new ToolStripMenuItem("退出", null, async delegate { await ExitApplication(); });
        menu.Items.Add(exitItem);
        lightTheme = UsesLightTaskbar();
        currentIcon = CreateDownloadIcon(lightTheme);
        tray = new NotifyIcon { Text = "yt-dlp Studio", Icon = currentIcon, ContextMenuStrip = menu, Visible = true };
        tray.DoubleClick += delegate { OpenWindow(); };

        // Only a process-liveness check and registry read, no network polling.
        heartbeat = new System.Windows.Forms.Timer { Interval = 2000 };
        heartbeat.Tick += delegate
        {
            if (parent.HasExited) { ExitThread(); return; }
            bool light = UsesLightTaskbar();
            if (light != lightTheme)
            {
                Icon old = currentIcon;
                currentIcon = CreateDownloadIcon(light);
                tray.Icon = currentIcon;
                lightTheme = light;
                old.Dispose();
            }
        };
        heartbeat.Start();
    }

    private void OpenWindow()
    {
        if ((DateTime.UtcNow - lastOpen).TotalMilliseconds < 800) return;
        lastOpen = DateTime.UtcNow;
        try
        {
            string launcher = Path.Combine(root, "scripts", "launch.ps1");
            Process.Start(new ProcessStartInfo
            {
                FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), @"WindowsPowerShell\v1.0\powershell.exe"),
                Arguments = "-NoProfile -ExecutionPolicy Bypass -File \"" + launcher + "\" -Port " + address.Port,
                WorkingDirectory = root,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden
            });
        }
        catch (Exception ex) { ShowError("无法打开界面", ex.Message); }
    }

    private async Task ExitApplication()
    {
        if (!exitItem.Enabled) return;
        exitItem.Enabled = false;
        try
        {
            if (parent.HasExited) { ExitThread(); return; }
            string bootstrap = await client.GetStringAsync("/api/bootstrap");
            Dictionary<string, object> state = serializer.Deserialize<Dictionary<string, object>>(bootstrap);
            object app, processId, sessionToken, environment;
            // Existing Studio servers already publish their project root. This also lets
            // the tray attach to a pre-tray release without restarting that server.
            if (!state.TryGetValue("environment", out environment) ||
                !String.Equals(Path.GetFullPath(Convert.ToString(((Dictionary<string, object>)environment)["root"])), root, StringComparison.OrdinalIgnoreCase) ||
                (state.TryGetValue("app", out app) && (string)app != "yt-dlp-studio") ||
                (state.TryGetValue("pid", out processId) && Convert.ToInt32(processId) != parent.Id) ||
                !state.TryGetValue("token", out sessionToken))
                throw new InvalidOperationException("本机服务已更换，请重新启动应用。");
            using (HttpRequestMessage request = new HttpRequestMessage(HttpMethod.Post, "/api/shutdown"))
            {
                request.Headers.Add("X-App-Token", (string)sessionToken);
                request.Content = new StringContent("{}", Encoding.UTF8, "application/json");
                using (HttpResponseMessage response = await client.SendAsync(request))
                {
                    string text = await response.Content.ReadAsStringAsync();
                    if (!response.IsSuccessStatusCode)
                    {
                        var error = serializer.Deserialize<Dictionary<string, object>>(text);
                        ShowError("暂时无法退出", Convert.ToString(error["error"]));
                        return;
                    }
                }
            }
            ExitThread();
        }
        catch (Exception ex)
        {
            if (parent.HasExited) ExitThread();
            else ShowError("退出失败", ex is HttpRequestException ? "无法连接下载服务，请稍后重试。" : ex.Message);
        }
        finally { if (!disposed) exitItem.Enabled = true; }
    }

    private void ShowError(string title, string message)
    {
        if (!disposed) tray.ShowBalloonTip(5000, title, message, ToolTipIcon.Warning);
    }

    private static bool UsesLightTaskbar()
    {
        try
        {
            using (RegistryKey key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize"))
                return key != null && Convert.ToInt32(key.GetValue("SystemUsesLightTheme", 0)) != 0;
        }
        catch { return false; }
    }

    [DllImport("user32.dll")] private static extern bool DestroyIcon(IntPtr handle);

    private static Icon CreateDownloadIcon(bool light)
    {
        using (Bitmap bitmap = new Bitmap(32, 32))
        using (Graphics g = Graphics.FromImage(bitmap))
        using (Pen pen = new Pen(light ? Color.FromArgb(40, 45, 52) : Color.White, 2.8f))
        {
            g.Clear(Color.Transparent);
            g.SmoothingMode = SmoothingMode.AntiAlias;
            pen.StartCap = pen.EndCap = LineCap.Round;
            pen.LineJoin = LineJoin.Round;
            g.DrawLine(pen, 16, 5, 16, 20);
            g.DrawLines(pen, new PointF[] { new PointF(10, 14), new PointF(16, 20), new PointF(22, 14) });
            g.DrawLines(pen, new PointF[] { new PointF(6, 22), new PointF(6, 27), new PointF(26, 27), new PointF(26, 22) });
            IntPtr handle = bitmap.GetHicon();
            try { return (Icon)Icon.FromHandle(handle).Clone(); }
            finally { DestroyIcon(handle); }
        }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing && !disposed)
        {
            disposed = true;
            heartbeat.Stop();
            heartbeat.Dispose();
            tray.Visible = false;
            tray.Dispose();
            currentIcon.Dispose();
            menu.Dispose();
            client.Dispose();
            parent.Dispose();
        }
        base.Dispose(disposing);
    }
}
