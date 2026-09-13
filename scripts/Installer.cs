using System;
using System.IO;
using System.IO.Compression;
using System.Drawing;
using System.Diagnostics;
using System.Linq;
using System.Reflection;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Win32;

internal static class Installer
{
    const string Product = "yt-dlp Studio";
    const string Key = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\YtDlpStudio";
    static string DefaultFolder { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", Product); } }
    static string Shortcut { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), Product + ".lnk"); } }

    [STAThread]
    static int Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        try
        {
#if UNINSTALL
            if (args.Length == 2 && args[0] == "--remove") { Remove(args[1]); return 0; }
            string root = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
            if (MessageBox.Show("卸载 yt-dlp Studio？下载文件和个人设置会保留。", Product, MessageBoxButtons.OKCancel, MessageBoxIcon.Question) != DialogResult.OK) return 0;
            EnsureClosed(root);
            string copy = Path.Combine(Path.GetTempPath(), "ytdlp-uninstall-" + Guid.NewGuid().ToString("N") + ".exe");
            File.Copy(Assembly.GetExecutingAssembly().Location, copy);
            Process.Start(new ProcessStartInfo(copy, "--remove \"" + root + "\"") { UseShellExecute = true });
#else
            if (args.Length == 2 && args[0] == "--verify-package") { Extract(args[1]); return 0; }
            using (var form = new Form { Text = "安装 " + Product, ClientSize = new Size(480, 235), StartPosition = FormStartPosition.CenterScreen, FormBorderStyle = FormBorderStyle.FixedDialog, MaximizeBox = false, BackColor = Color.White })
            {
                var title = new Label { Text = Product, Font = new Font("Segoe UI", 19), Left = 25, Top = 22, Width = 420, Height = 40 };
                var note = new Label { Text = "安装到当前用户，无需管理员权限。", Left = 28, Top = 75, Width = 420 };
                var location = new TextBox { Text = DefaultFolder, Left = 28, Top = 106, Width = 420, ReadOnly = true };
                var progress = new ProgressBar { Left = 28, Top = 145, Width = 420, Visible = false, Style = ProgressBarStyle.Marquee };
                var button = new Button { Text = "安装", Left = 338, Top = 186, Width = 110, Height = 31 };
                bool busy = false;
                form.FormClosing += (s, e) => { if (busy) e.Cancel = true; };
                button.Click += async (s, e) => {
                    if (button.Text == "打开软件") { Process.Start(new ProcessStartInfo(Path.Combine(DefaultFolder, Product + ".exe")) { UseShellExecute = true }); form.Close(); return; }
                    busy = true; button.Enabled = false; progress.Visible = true; note.Text = "正在安装…";
                    try { await Task.Run(() => Extract(DefaultFolder)); Register(DefaultFolder); note.Text = "安装完成，已添加开始菜单快捷方式。"; button.Text = "打开软件"; }
                    catch (Exception error) { note.Text = "安装未完成，请重试。"; MessageBox.Show(form, error.Message, Product, MessageBoxButtons.OK, MessageBoxIcon.Error); }
                    finally { busy = false; progress.Visible = false; button.Enabled = true; }
                };
                form.Controls.AddRange(new Control[] { title, note, location, progress, button });
                Application.Run(form);
            }
#endif
            return 0;
        }
        catch (Exception error) { if (args.Length > 0 && args[0] == "--verify-package") return 1; MessageBox.Show(error.Message, Product, MessageBoxButtons.OK, MessageBoxIcon.Error); return 1; }
    }

    static void EnsureClosed(string root)
    {
        foreach (var process in Process.GetProcessesByName(Product))
        {
            using (process) { try { if (string.Equals(process.MainModule.FileName, Path.Combine(root, Product + ".exe"), StringComparison.OrdinalIgnoreCase)) throw new IOException("请先从托盘退出 yt-dlp Studio，然后重试。"); } catch (System.ComponentModel.Win32Exception) { } }
        }
        // File sharing also prevents updating binaries while a download worker is still running.
        string node = Path.Combine(root, "bin", "node.exe");
        if (File.Exists(node)) using (File.Open(node, FileMode.Open, FileAccess.ReadWrite, FileShare.None)) { }
    }

    static string SafePath(string root, string relative)
    {
        string full = Path.GetFullPath(Path.Combine(root, relative));
        if (!full.StartsWith(root.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new IOException("安装文件路径无效。");
        return full;
    }

    static void Extract(string destination)
    {
        string root = Path.GetFullPath(destination);
        EnsureClosed(root);
        Directory.CreateDirectory(root);
        using (var payload = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip"))
        using (var zip = new ZipArchive(payload, ZipArchiveMode.Read))
        {
            foreach (var entry in zip.Entries)
            {
                string file = SafePath(root, entry.FullName);
                if (entry.FullName.EndsWith("/")) { Directory.CreateDirectory(file); continue; }
                Directory.CreateDirectory(Path.GetDirectoryName(file));
                entry.ExtractToFile(file, true);
            }
            File.WriteAllLines(Path.Combine(root, "installed-files.txt"), zip.Entries.Where(e => !e.FullName.EndsWith("/")).Select(e => e.FullName));
        }
    }

    static void Register(string root)
    {
        Type type = Type.GetTypeFromProgID("WScript.Shell");
        dynamic shell = Activator.CreateInstance(type);
        dynamic link = shell.CreateShortcut(Shortcut);
        link.TargetPath = Path.Combine(root, Product + ".exe");
        link.WorkingDirectory = root;
        link.IconLocation = link.TargetPath + ",0";
        link.Save();
        using (var key = Registry.CurrentUser.CreateSubKey(Key))
        {
            key.SetValue("DisplayName", Product); key.SetValue("DisplayVersion", "1.0.0");
            key.SetValue("InstallLocation", root); key.SetValue("DisplayIcon", Path.Combine(root, Product + ".exe"));
            key.SetValue("UninstallString", "\"" + Path.Combine(root, "Uninstall.exe") + "\"");
            key.SetValue("NoModify", 1); key.SetValue("NoRepair", 1);
        }
    }

    static void Remove(string destination)
    {
        string root = Path.GetFullPath(destination);
        if (!string.Equals(root, DefaultFolder, StringComparison.OrdinalIgnoreCase)) throw new IOException("卸载目录不匹配。");
        EnsureClosed(root);
        string manifest = Path.Combine(root, "installed-files.txt");
        if (!File.Exists(manifest)) throw new IOException("安装清单缺失，无法自动卸载。");
        foreach (string relative in File.ReadAllLines(manifest))
        {
            string file = SafePath(root, relative);
            if (File.Exists(file)) File.Delete(file);
        }
        File.Delete(manifest);
        if (File.Exists(Shortcut)) File.Delete(Shortcut);
        Registry.CurrentUser.DeleteSubKeyTree(Key, false);
        MessageBox.Show("已卸载。下载文件和个人设置仍保留在原目录。", Product);
    }
}
