using System;
using System.Management;
using System.Security.Cryptography;
using System.Text;

namespace GameHubLicensing
{
    public static class DeviceIdHelper
    {
        // Public method yang dipanggil app
        public static string GetDeviceId()
        {
            try
            {
                string cpu = GetCpuId();
                string mb = GetMotherboardSerial();
                string uuid = GetSystemUuid();

                // Fallback jika ada yang kosong
                if (string.IsNullOrEmpty(cpu)) cpu = "missing_cpu";
                if (string.IsNullOrEmpty(mb)) mb = "missing_mb";
                if (string.IsNullOrEmpty(uuid)) uuid = "missing_uuid";

                string raw = cpu + "|" + mb + "|" + uuid;

                return Sha256(raw);
            }
            catch
            {
                // Worst case fallback
                return Sha256(Environment.MachineName + "_" + Environment.UserName);
            }
        }

        // === Hardware Collectors ===

        private static string GetCpuId()
        {
            try
            {
                using var searcher = new ManagementObjectSearcher("select ProcessorId from Win32_Processor");
                foreach (var item in searcher.Get())
                    return item["ProcessorId"]?.ToString()?.Trim() ?? "";
            }
            catch { }
            return "";
        }

        private static string GetMotherboardSerial()
        {
            try
            {
                using var searcher = new ManagementObjectSearcher("select SerialNumber from Win32_BaseBoard");
                foreach (var item in searcher.Get())
                    return item["SerialNumber"]?.ToString()?.Trim() ?? "";
            }
            catch { }
            return "";
        }

        private static string GetSystemUuid()
        {
            try
            {
                using var searcher = new ManagementObjectSearcher("select UUID from Win32_ComputerSystemProduct");
                foreach (var item in searcher.Get())
                    return item["UUID"]?.ToString()?.Trim() ?? "";
            }
            catch { }
            return "";
        }

        // === HASH FUNCTION ===

        private static string Sha256(string input)
        {
            using var sha = SHA256.Create();
            byte[] bytes = sha.ComputeHash(Encoding.UTF8.GetBytes(input));
            var sb = new StringBuilder();
            foreach (var b in bytes)
                sb.Append(b.ToString("x2"));
            return sb.ToString();
        }
    }
}
