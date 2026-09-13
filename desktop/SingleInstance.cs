using System.Diagnostics;
using System.Security.Principal;
using System.Text.Json;

namespace YtDlpStudio;

internal sealed class SingleInstance : IDisposable
{
    private readonly Mutex mutex;
    private bool owned;

    private SingleInstance(Mutex mutex) { this.mutex = mutex; }

    // Shared by installed/portable copies, independent of their directory.
    public static string MutexName => @"Local\YtDlpStudio.SingleInstance." + WindowsIdentity.GetCurrent().User!.Value;

    public static SingleInstance? TryAcquire() => TryAcquire(MutexName, true);

    internal static SingleInstance? TryAcquire(string name, bool checkLegacy)
    {
        var instance = new SingleInstance(new Mutex(false, name));
        try
        {
            try { instance.owned = instance.mutex.WaitOne(0); }
            catch (AbandonedMutexException) { instance.owned = true; }
            if (!instance.owned || (checkLegacy && HasRunningLegacyInstance()))
            {
                instance.Dispose();
                return null;
            }
            return instance;
        }
        catch { instance.Dispose(); throw; }
    }

    private static bool HasRunningLegacyInstance()
    {
        using var current = Process.GetCurrentProcess();
        foreach (var process in Process.GetProcessesByName("yt-dlp Studio"))
        {
            using (process)
            {
                if (process.Id == current.Id) continue;
                try
                {
                    if (process.SessionId != current.SessionId) continue;
                    var executable = process.MainModule?.FileName;
                    if (executable == null) continue;
                    var session = Path.Combine(Path.GetDirectoryName(executable)!, "data", "desktop-session.json");
                    // A startup contender has not written its session yet. Only an
                    // initialized instance with this exact PID can block the winner.
                    using var json = JsonDocument.Parse(File.ReadAllText(session));
                    if (json.RootElement.GetProperty("pid").GetInt32() == process.Id && !process.HasExited) return true;
                }
                catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException
                    or KeyNotFoundException or InvalidOperationException or System.ComponentModel.Win32Exception) { }
            }
        }
        return false;
    }

    public void Dispose()
    {
        if (owned) { mutex.ReleaseMutex(); owned = false; }
        mutex.Dispose();
    }
}
