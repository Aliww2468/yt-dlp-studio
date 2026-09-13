using System.Diagnostics;
using YtDlpStudio;

if (args.Length > 0 && args[0] == "worker")
{
    var dir = args[1];
    var deadline = DateTime.UtcNow.AddSeconds(20);
    while (!File.Exists(Path.Combine(dir, "start")))
    {
        if (DateTime.UtcNow > deadline) return 3;
        Thread.Sleep(10);
    }
    using var instance = SingleInstance.TryAcquire(args[2], false);
    File.WriteAllText(Path.Combine(dir, Environment.ProcessId + ".result"), instance == null ? "blocked" : "acquired");
    if (instance != null)
        while (!File.Exists(Path.Combine(dir, "release")))
        {
            if (DateTime.UtcNow > deadline) return 4;
            Thread.Sleep(10);
        }
    return 0;
}

var root = Path.Combine(Path.GetTempPath(), "studio-instance-tests-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(root);
var workers = new List<Process>();
try
{
    foreach (var crash in new[] {false, true})
    {
        var dir = Path.Combine(root, crash ? "crash" : "normal");
        Directory.CreateDirectory(dir);
        var name = @"Local\StudioInstanceTest-" + Guid.NewGuid().ToString("N");
        for (int i = 0; i < 8; i++)
        {
            var info = new ProcessStartInfo(Environment.ProcessPath!) { UseShellExecute = false, CreateNoWindow = true };
            info.ArgumentList.Add("worker"); info.ArgumentList.Add(dir); info.ArgumentList.Add(name);
            workers.Add(Process.Start(info)!);
        }
        File.WriteAllText(Path.Combine(dir, "start"), "go");
        var timeout = Stopwatch.StartNew();
        while (Directory.GetFiles(dir, "*.result").Length != 8 && timeout.ElapsedMilliseconds < 10000) Thread.Sleep(20);
        var results = Directory.GetFiles(dir, "*.result");
        if (results.Length != 8 || results.Count(f => File.ReadAllText(f) == "acquired") != 1)
            throw new Exception("Concurrent launches did not produce exactly one owner.");
        using (var duplicate = SingleInstance.TryAcquire(name, false))
            if (duplicate != null) throw new Exception("Duplicate acquired an owned mutex.");
        if (crash)
        {
            var winner = int.Parse(Path.GetFileNameWithoutExtension(results.Single(f => File.ReadAllText(f) == "acquired")));
            using var process = Process.GetProcessById(winner);
            process.Kill(); process.WaitForExit();
        }
        else File.WriteAllText(Path.Combine(dir, "release"), "go");
        foreach (var worker in workers) if (!worker.WaitForExit(5000)) throw new Exception("Worker did not exit.");
        using var restarted = SingleInstance.TryAcquire(name, false);
        if (restarted == null) throw new Exception("An exited process blocked a new launch.");
        Console.WriteLine(crash ? "PASS: eight simultaneous launches; restart after owner crash" : "PASS: eight simultaneous launches; restart after normal exit");
        foreach (var worker in workers) worker.Dispose();
        workers.Clear();
    }
    return 0;
}
finally
{
    foreach (var worker in workers) { if (!worker.HasExited) worker.Kill(); worker.Dispose(); }
    Directory.Delete(root, true);
}
