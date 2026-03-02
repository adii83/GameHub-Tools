using MailKit;
using MailKit.Net.Imap;
using MailKit.Search;
using MimeKit;
using System;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading.Tasks;

namespace GameHubDesktop.Services
{
    public static class SteamGuardService
    {
        public static Action<string>? Log { get; set; }
        
        private static void LogInfo(string message)
        {
            try { Log?.Invoke($"[SteamGuard] {message}"); } catch { }
        }

        public static async Task<string> FetchLatestSteamGuardCodeAsync(string targetEmail)
        {


            // Konfigurasi Email IMAP (HARAP DIGANTI dengan Email Dummy Anda)
            string imapServer = "imap.gmail.com";
            int port = 993;
            // Gunakan targetEmail jika tidak kosong, tetapi untuk Login pakai akun Master Anda
            // Asumsi: 1 Akun Master (Dummy) menangani segala inbox.
            // ATAU: Anda akan menyediaan kredensial langsung di bawah ini
            
            // TODO: Tulis alamat email akun Gmail Master Anda di sini (Email yang menerima steam guard forward)
            string myEmail = "residentevil83geel@gmail.com"; 
            string appPassword = "ebeycoskkfxjfcgp"; 
            
            // Validasi setup lokal
            if (myEmail == "email_utama_anda@gmail.com")
            {
                return "Error: Harap ganti variabel 'myEmail' dengan email asli Anda di SteamGuardService.cs baris 32!";
            }

            if (appPassword == "ganti_dengan_pass_app") 
            {
                return "Error: Harap isi 'appPassword' Anda pada SteamGuardService.cs baris 33!";
            }

            try
            {
                using (var client = new ImapClient())
                {
                    // For demo-purposes, accept all SSL certificates (in case the server supports STARTTLS)
                    client.ServerCertificateValidationCallback = (s, c, h, e) => true;

                    LogInfo($"Menghubungkan ke {imapServer} port {port}...");
                    await client.ConnectAsync(imapServer, port, true);

                    LogInfo($"Login menggunakan {myEmail}...");
                    await client.AuthenticateAsync(myEmail, appPassword);

                    // Buka Inbox (Hanya Baca)
                    var inbox = client.Inbox;
                    await inbox.OpenAsync(FolderAccess.ReadOnly);

                    LogInfo($"Pencarian Email Steampowered...");
                    
                    // Filter: Diterima dari Steampowered dalam 30 menit terakhir
                    var query = SearchQuery.FromContains("noreply@steampowered.com")
                               .And(SearchQuery.DeliveredAfter(DateTime.UtcNow.AddMinutes(-30)));
                               
                    // Filter ekstra: memastikan email memuat username game spesifik yang di-klik
                    if (!string.IsNullOrWhiteSpace(targetEmail))
                    {
                        query = query.And(SearchQuery.BodyContains(targetEmail));
                    }

                    var uids = await inbox.SearchAsync(query);
                    if (uids.Count == 0)
                    {
                        LogInfo("Tidak ada email kode Steam Guard terbaru dalam 30 menit terakhir.");
                        await client.DisconnectAsync(true);
                        return "Error: Tidak ada email kode Steam Guard terbaru yang masuk. Pastikan Anda sudah memicu pengiriman kode dari Steam!";
                    }

                    // Ambil UID terbaru (UID yang paling besar biasanya yang paling baru)
                    var latestUid = uids.OrderByDescending(x => x).First();
                    var message = await inbox.GetMessageAsync(latestUid);

                    LogInfo($"Memeriksa pesan terbaru: {message.Subject}...");

                    // Ekstrak Teks untuk Regex.
                    string bodyText = message.TextBody ?? message.HtmlBody ?? "";

                    // Regex Steam Guard: biasanya berupa 5 huruf kapital/angka beruntun
                    // Contoh A1B2C di dalam blok pesan tebal.
                    // Ada 2 style: "Login code" atau "Access from new"
                    
                    Regex rgx = new Regex(@"[A-Z0-9]{5}");
                    // Steam Account Guard logic khusus:
                    // Biasanya Steam Guard code muncul di email dengan teks "Here is the Steam Guard code you need to login to account"
                    // Kode persis 5 karakter kapital dan angka.
                    
                    // Persempit pencarian agar tidak mencamplok teks random dari footer:
                    Match match = Regex.Match(bodyText, @"\b[A-Z0-9]{5}\b");
                    
                    if (match.Success)
                    {
                        LogInfo($"Code found: {match.Value}");
                        await client.DisconnectAsync(true);
                        return match.Value;
                    }
                    else
                    {
                        LogInfo("Email ditemukan, tetapi gagal mengekstrak 5 karakter kode.");
                        await client.DisconnectAsync(true);
                        return "Error: Email berhasil dibaca, namun format kode 5-huruf tidak ditemukan.";
                    }
                }
            }
            catch (Exception ex)
            {
                LogInfo($"Koneksi/Fetch gagal: {ex.Message}");
                return $"Error: Gagal mengakses Gmail ({ex.Message})";
            }
        }
    }
}
