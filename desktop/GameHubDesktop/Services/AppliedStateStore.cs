using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;

namespace GameHubDesktop.Services
{
    public static class AppliedStateStore
    {
        private static readonly object _lock = new();
        private static readonly ConcurrentDictionary<int, bool> _applied = new();
        private static string _storePath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "GameHub", "applied.json");
        private static bool _initialized = false;

        public static void Initialize()
        {
            if (_initialized) return;
            try
            {
                var dir = Path.GetDirectoryName(_storePath)!;
                if (!Directory.Exists(dir)) Directory.CreateDirectory(dir);
                if (File.Exists(_storePath))
                {
                    var json = File.ReadAllText(_storePath);
                    if (!string.IsNullOrWhiteSpace(json))
                    {
                        var dict = JsonSerializer.Deserialize<Dictionary<string, bool>>(json);
                        if (dict != null)
                        {
                            foreach (var kv in dict)
                            {
                                if (int.TryParse(kv.Key, out var id)) _applied[id] = kv.Value;
                            }
                        }
                    }
                }
            }
            catch { }
            _initialized = true;
        }

        public static void SetApplied(int appid, bool applied)
        {
            Initialize();
            lock (_lock)
            {
                _applied[appid] = applied;
                Persist();
            }
        }

        public static bool TryGet(int appid, out bool applied)
        {
            Initialize();
            return _applied.TryGetValue(appid, out applied);
        }

        public static void ClearAll()
        {
            try
            {
                lock (_lock)
                {
                    _applied.Clear();
                }
                if (File.Exists(_storePath))
                {
                    File.Delete(_storePath);
                }
            }
            catch { }
        }

        private static void Persist()
        {
            try
            {
                var dict = new Dictionary<string, bool>();
                foreach (var kv in _applied) dict[kv.Key.ToString()] = kv.Value;
                var json = JsonSerializer.Serialize(dict, new JsonSerializerOptions { WriteIndented = true });
                File.WriteAllText(_storePath, json);
            }
            catch { }
        }
    }
}