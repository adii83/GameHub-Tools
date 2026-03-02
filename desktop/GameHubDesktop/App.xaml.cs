using System.Runtime.InteropServices;

namespace GameHubDesktop
{
    public partial class App : System.Windows.Application
    {
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool AllocConsole();

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool AttachConsole(int dwProcessId);

        static App()
        {
            // Attach to existing console (if launched from CMD/PowerShell) or create new one
            if (!AttachConsole(-1)) // -1 = ATTACH_PARENT_PROCESS
            {
                AllocConsole(); // Fallback: create new console window
            }
            System.Console.OutputEncoding = System.Text.Encoding.UTF8;
            System.Console.WriteLine("===========================================");
            System.Console.WriteLine("      GameHub Desktop - Diagnostic Log     ");
            System.Console.WriteLine("===========================================");
        }
    }
}
