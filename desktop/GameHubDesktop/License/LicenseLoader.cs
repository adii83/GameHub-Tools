using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;

namespace GameHubLicensing
{
    public class LocalLicense
    {
        public string? license_key { get; set; }
        public string? device_id { get; set; }
        public string? plan { get; set; }
        public string? activated_at { get; set; }
    }

    public static class LicenseLoader
    {
        private const string SECRET = "adigeel83271120043522012711040003"; // GANTI WAJIB
        private static readonly string LicenseFolder =
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "GameHub");
        
        private static readonly string LicenseFile = Path.Combine(LicenseFolder, "license.dat");

        // MAIN FUNCTION → CALL THIS WHEN APP STARTS
        public static LocalLicense? LoadLicense()
        {
            try
            {
                if (!File.Exists(LicenseFile))
                    return null;

                string encrypted = File.ReadAllText(LicenseFile);
                string json = Decrypt(encrypted);

                var data = JsonSerializer.Deserialize<LocalLicense>(json);

                if (data == null)
                    return null;

                // Validate device binding
                // Note: GetDeviceId bisa lambat karena WMI, tapi dipanggil sync saat startup
                // Untuk menghindari freeze, kita bisa skip validation jika terlalu lama (optional)
                string currentDevice = DeviceIdHelper.GetDeviceId();

                if (data.device_id != currentDevice)
                {
                    // device mismatch
                    return null;
                }

                return data;
            }
            catch
            {
                return null;
            }
        }

        // SAVE LICENSE TO LOCAL FILE (AFTER ACTIVATION SUCCESS)
        public static void SaveLicense(LocalLicense lic)
        {
            try
            {
                Directory.CreateDirectory(LicenseFolder);

                string json = JsonSerializer.Serialize(lic);
                string encrypted = Encrypt(json);

                // Gunakan async write untuk menghindari blocking
                File.WriteAllText(LicenseFile, encrypted);
            }
            catch (Exception ex)
            {
                // Log error tapi jangan throw (untuk mencegah freeze)
                System.Diagnostics.Debug.WriteLine($"Error saving license: {ex.Message}");
                throw; // Re-throw untuk ditangani oleh caller
            }
        }
        
        // Async version untuk menghindari blocking
        public static async Task SaveLicenseAsync(LocalLicense lic)
        {
            await Task.Run(() => SaveLicense(lic));
        }

        // AES ENCRYPTION
        private static string Encrypt(string plain)
        {
            using var aes = Aes.Create();
            aes.Key = Sha256(SECRET);
            aes.GenerateIV();

            using var encryptor = aes.CreateEncryptor(aes.Key, aes.IV);

            byte[] inputBytes = Encoding.UTF8.GetBytes(plain);
            byte[] encryptedBytes = encryptor.TransformFinalBlock(inputBytes, 0, inputBytes.Length);

            byte[] result = new byte[aes.IV.Length + encryptedBytes.Length];
            Buffer.BlockCopy(aes.IV, 0, result, 0, aes.IV.Length);
            Buffer.BlockCopy(encryptedBytes, 0, result, aes.IV.Length, encryptedBytes.Length);

            return Convert.ToBase64String(result);
        }

        // AES DECRYPTION
        private static string Decrypt(string encryptedBase64)
        {
            byte[] fullBytes = Convert.FromBase64String(encryptedBase64);

            using var aes = Aes.Create();
            aes.Key = Sha256(SECRET);

            byte[] iv = new byte[16];
            byte[] cipherBytes = new byte[fullBytes.Length - 16];

            Buffer.BlockCopy(fullBytes, 0, iv, 0, 16);
            Buffer.BlockCopy(fullBytes, 16, cipherBytes, 0, cipherBytes.Length);

            aes.IV = iv;

            using var decryptor = aes.CreateDecryptor(aes.Key, aes.IV);
            byte[] decryptedBytes = decryptor.TransformFinalBlock(cipherBytes, 0, cipherBytes.Length);

            return Encoding.UTF8.GetString(decryptedBytes);
        }

        private static byte[] Sha256(string s)
        {
            using var sha = SHA256.Create();
            return sha.ComputeHash(Encoding.UTF8.GetBytes(s));
        }
    }
}
