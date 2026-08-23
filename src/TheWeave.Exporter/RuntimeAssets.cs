using System.Reflection;
using System.Security.Cryptography;
using System.Text;

namespace TheWeave.Exporter;

/// <summary>
/// The canonical shared runtime (main.css/main.js) that every exported site gets, embedded
/// directly in this assembly so it's available identically in tests, the editor app, and a
/// published build - no dependency on output-directory copying.
/// </summary>
public static class RuntimeAssets
{
    public static string ReadMainCss() => ReadEmbedded("runtime.main.css");

    public static string ReadMainJs() => ReadEmbedded("runtime.main.js");

    /// <summary>The persistent shell's own script - see ShellRenderer.</summary>
    public static string ReadShellJs() => ReadEmbedded("runtime.shell.js");

    /// <summary>
    /// Short hash of the runtime's own content, appended as a "?v=" query string to every
    /// exported page's css/js references. main.css/main.js keep the same filename across every
    /// export (that's the point - they overwrite in place), which means a browser that already
    /// has a tab open on a previously-exported copy of the site can go on serving a cached,
    /// stale copy of them after a re-export with real behavior changes in it - exactly the kind
    /// of "I re-exported and it still doesn't work" confusion this exists to rule out.
    /// </summary>
    public static string Version { get; } = ComputeVersion();

    private static string ComputeVersion()
    {
        var combined = ReadMainCss() + ReadMainJs() + ReadShellJs();
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(combined));
        return Convert.ToHexString(hash)[..8].ToLowerInvariant();
    }

    private static string ReadEmbedded(string nameSuffix)
    {
        var assembly = typeof(RuntimeAssets).Assembly;
        var resourceName = assembly.GetManifestResourceNames()
            .SingleOrDefault(n => n.EndsWith(nameSuffix, StringComparison.Ordinal))
            ?? throw new InvalidOperationException(
                $"Embedded resource ending in '{nameSuffix}' not found. Available: {string.Join(", ", assembly.GetManifestResourceNames())}");

        using var stream = assembly.GetManifestResourceStream(resourceName)!;
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }
}
