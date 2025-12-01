using System;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace GameHubLicensing
{   
    public class LicenseResponse
    {
        public string? status { get; set; }
        public string? plan { get; set; }
        public string? code { get; set; }
        public string? message { get; set; }
        public string? reason { get; set; } // Untuk response dari Supabase RPC
    }

    public static class LicenseActivator
    {
        // Jangan gunakan static HttpClient untuk menghindari masalah headers yang ter-cache
        // Buat instance baru setiap kali (atau gunakan HttpClientFactory di production)

        // Ganti sesuai project Supabase kamu
        private const string SUPABASE_URL = "https://ghmzmvrjazvqiaufjrjt.supabase.co";
        private const string SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdobXptdnJqYXp2cWlhdWZqcmp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ2MDI4NTUsImV4cCI6MjA4MDE3ODg1NX0.FyOhPNk9Yvc0g0Ki0W3ZEeJC1d3N5gv1WWXgyXsl0xg";

        public static async Task<LicenseResponse> ActivateAsync(string licenseKey, string deviceId, System.Threading.CancellationToken cancellationToken = default)
        {
            string url = $"{SUPABASE_URL}/rest/v1/rpc/activate_license";

            var payload = new
            {
                p_license_key = licenseKey,
                p_device_id = deviceId
            };

            var json = JsonSerializer.Serialize(payload);
            var content = new StringContent(json, Encoding.UTF8, "application/json");

            // Content headers (hanya header yang valid untuk HttpContent)
            content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/json");
            content.Headers.Add("Prefer", "return=representation");

            // Buat request message untuk kontrol lebih baik
            var request = new HttpRequestMessage(HttpMethod.Post, url)
            {
                Content = content
            };
            
            // Request headers (Authorization dan apikey harus di sini, bukan di content)
            request.Headers.Add("apikey", SUPABASE_ANON_KEY);
            request.Headers.Add("Authorization", $"Bearer {SUPABASE_ANON_KEY}");

            try
            {
                // Buat HttpClient baru setiap kali untuk menghindari masalah headers
                using (var httpClient = new HttpClient())
                {
                    // Set timeout lebih pendek (8 detik) agar bisa di-cancel oleh CancellationToken
                    httpClient.Timeout = TimeSpan.FromSeconds(8);
                    
                    // Check cancellation sebelum request
                    cancellationToken.ThrowIfCancellationRequested();
                    
                    // Gunakan CancellationToken untuk bisa di-cancel
                    var res = await httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
                    var resString = await res.Content.ReadAsStringAsync(cancellationToken);

                // Cek jika response adalah error dari Supabase
                if (!res.IsSuccessStatusCode)
                {
                    // Coba parse error message dari Supabase
                    try
                    {
                        var errorObj = JsonSerializer.Deserialize<System.Text.Json.JsonElement>(resString);
                        string errorMsg = "Unknown error";
                        
                        if (errorObj.TryGetProperty("message", out var msg))
                            errorMsg = msg.GetString() ?? errorMsg;
                        else if (errorObj.TryGetProperty("error", out var err))
                            errorMsg = err.GetString() ?? errorMsg;
                        else if (errorObj.TryGetProperty("hint", out var hint))
                            errorMsg = hint.GetString() ?? errorMsg;
                        
                        // Check for specific Supabase errors
                        if (resString.Contains("Invalid API key") || resString.Contains("invalid_api_key"))
                            errorMsg = "Invalid API key. Periksa konfigurasi Supabase API key.";
                        else if (resString.Contains("JWT") || resString.Contains("token"))
                            errorMsg = "API key tidak valid atau expired.";
                        
                        return new LicenseResponse
                        {
                            status = "error",
                            message = $"Supabase error ({res.StatusCode}): {errorMsg}"
                        };
                    }
                    catch
                    {
                        return new LicenseResponse
                        {
                            status = "error",
                            message = $"HTTP error ({res.StatusCode}): {resString}"
                        };
                    }
                }

                // parse JSON response
                var parsed = JsonSerializer.Deserialize<LicenseResponse>(resString);

                if (parsed != null)
                {
                    // Jika response punya reason tapi tidak punya message, gunakan reason sebagai message
                    if (parsed.status == "error" && string.IsNullOrEmpty(parsed.message) && !string.IsNullOrEmpty(parsed.reason))
                    {
                        parsed.message = parsed.reason;
                    }
                    return parsed;
                }

                    return new LicenseResponse
                    {
                        status = "error",
                        message = $"Invalid response from server: {resString}"
                    };
                }
            }
            catch (Exception ex)
            {
                return new LicenseResponse
                {
                    status = "error",
                    message = "Network error: " + ex.Message
                };
            }
        }
    }
}
