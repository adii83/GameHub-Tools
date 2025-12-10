using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;

namespace GameHubDesktop.Services
{
    public class AppLogService
    {
        private readonly ConcurrentQueue<string> _lines = new();
        private const int MaxLines = 5000;

        public event Action<string>? Appended;

        public void Append(string message)
        {
            var line = $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] {message}";
            _lines.Enqueue(line);
            while (_lines.Count > MaxLines && _lines.TryDequeue(out _)) { }
            try { Appended?.Invoke(line); } catch { }
        }

        public List<string> GetAll() => _lines.ToList();

        public (bool success, string? path, string? error) SaveToDefault()
        {
            try
            {
                var downloads = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");
                var folder = Path.Combine(downloads, "GameHub Log");
                Directory.CreateDirectory(folder);
                var timestamp = DateTime.Now.ToString("yyyy-MM-dd_HH-mm-ss", CultureInfo.InvariantCulture);
                var filename = $"gamehub-log-{timestamp}.txt";
                var path = Path.Combine(folder, filename);
                File.WriteAllLines(path, _lines.ToArray());
                return (true, path, null);
            }
            catch (Exception ex)
            {
                return (false, null, ex.Message);
            }
        }
    }
}
