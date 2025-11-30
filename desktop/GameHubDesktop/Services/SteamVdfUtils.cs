using System;
using System.Collections.Generic;
using System.IO;

namespace GameHubDesktop.Services
{
    public static class SteamVdfUtils
    {
        // Find the library path that contains a specific appid using the "apps" map
        public static string? FindLibraryPathForApp(string baseSteamPath, int appid)
        {
            try
            {
                var libraryVdfPath = Path.Combine(baseSteamPath, "steamapps", "libraryfolders.vdf");
                if (!File.Exists(libraryVdfPath)) return null;

                string? currentPath = null;
                bool inApps = false;
                int appsBraceDepth = 0;

                foreach (var raw in File.ReadLines(libraryVdfPath))
                {
                    var line = raw.Trim();
                    if (string.IsNullOrEmpty(line)) continue;

                    // Capture path within a library block
                    if (line.StartsWith("\"path\"", StringComparison.OrdinalIgnoreCase))
                    {
                        var parts = line.Split('"', StringSplitOptions.RemoveEmptyEntries);
                        if (parts.Length >= 2)
                        {
                            var p = parts[^1].Replace("\\\\", "\\");
                            currentPath = p;
                        }
                        continue;
                    }

                    // Enter apps map
                    if (!inApps && line.Equals("\"apps\"", StringComparison.Ordinal))
                    {
                        inApps = true;
                        appsBraceDepth = 0;
                        continue;
                    }

                    if (inApps)
                    {
                        // Track braces to know when apps block ends
                        if (line == "{") { appsBraceDepth++; continue; }
                        if (line == "}")
                        {
                            appsBraceDepth--;
                            if (appsBraceDepth <= 0) { inApps = false; }
                            continue;
                        }

                        // Lines inside apps look like: "648800"    "1"
                        if (line.StartsWith("\""))
                        {
                            var parts = line.Split('"', StringSplitOptions.RemoveEmptyEntries);
                            if (parts.Length > 0 && int.TryParse(parts[0], out var id))
                            {
                                if (id == appid && !string.IsNullOrWhiteSpace(currentPath))
                                {
                                    return currentPath;
                                }
                            }
                        }
                    }
                }
            }
            catch { }
            return null;
        }

        // Parse libraryfolders.vdf to a list of library root paths
        public static List<string> ParseLibraryFolders(string libraryVdfPath)
        {
            var libs = new List<string>();
            try
            {
                if (!File.Exists(libraryVdfPath)) return libs;
                var text = File.ReadAllText(libraryVdfPath);
                using var sr = new StringReader(text);
                string? line;
                while ((line = sr.ReadLine()) != null)
                {
                    line = line.Trim();
                    // Matches lines like: "1"    "D:\\SteamLibrary"
                    if (line.StartsWith("\"") && line.Contains("\"\t\""))
                    {
                        var parts = line.Split('"', StringSplitOptions.RemoveEmptyEntries);
                        if (parts.Length >= 2)
                        {
                            var path = parts[1].Replace("\\\\", "\\");
                            if (Directory.Exists(path)) libs.Add(path);
                        }
                    }
                }
                // Always include the primary steam root
                var root = Directory.GetParent(Path.GetDirectoryName(libraryVdfPath)!)?.FullName;
                if (!string.IsNullOrEmpty(root)) libs.Add(root);
            }
            catch { }
            return libs;
        }

        // Parse appmanifest_<appid>.acf to get installdir
        public static string? ParseInstallDir(string manifestPath)
        {
            try
            {
                if (!File.Exists(manifestPath)) return null;
                foreach (var line in File.ReadLines(manifestPath))
                {
                    var t = line.Trim();
                    // "installdir"    "Game Folder Name"
                    if (t.StartsWith("\"installdir\""))
                    {
                        var parts = t.Split('"', StringSplitOptions.RemoveEmptyEntries);
                        if (parts.Length >= 2)
                        {
                            return parts[1];
                        }
                    }
                }
            }
            catch { }
            return null;
        }
    }
}