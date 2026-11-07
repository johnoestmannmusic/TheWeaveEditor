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

    /// <summary>Grid movement, loaded alongside main.js - see runtime/sokoban.js.</summary>
    public static string ReadSokobanJs() => ReadEmbedded("runtime.sokoban.js");

    /// <summary>Sokoban puzzles, loaded alongside main.js - see runtime/puzzle.js.</summary>
    public static string ReadPuzzleJs() => ReadEmbedded("runtime.puzzle.js");

    /// <summary>A puzzle board being played, loaded after puzzle.js - see runtime/board.js.</summary>
    public static string ReadBoardJs() => ReadEmbedded("runtime.board.js");

    /// <summary>
    /// The parts puzzle.js brings together, in the order they load, just before it and in the same folder - see
    /// runtime/puzzle.js.
    /// </summary>
    public static readonly IReadOnlyList<string> PuzzleScriptParts = ["puzzleRules.js", "puzzleColours.js", "puzzleDrawing.js"];

    /// <summary>
    /// The rest of the page script, split from main.js by concern, in the order they load, just after it and in the same
    /// folder - see runtime/main.js.
    /// </summary>
    public static readonly IReadOnlyList<string> PageScriptParts = ["loading.js", "cards.js", "map.js", "audio.js", "trackFocus.js", "effects.js"];

    /// <summary>Where a script part goes: in the same folder as the file it belongs with, like "jsx/main.js".</summary>
    public static string Beside(string path, string fileName)
    {
        var slash = path.Replace('\\', '/').LastIndexOf('/');
        return slash < 0 ? fileName : path[..(slash + 1)] + fileName;
    }

    /// <summary>One of the runtime's script parts, by its file name - see PuzzleScriptParts and PageScriptParts.</summary>
    public static string ReadScriptPart(string fileName) => ReadEmbedded("runtime." + fileName);

    /// <summary>The persistent shell's own script - see ShellRenderer.</summary>
    public static string ReadShellJs() => ReadEmbedded("runtime.shell.js");

    /// <summary>The repo-root AI-assisted-development disclosure statement - see DisclosurePageRenderer.</summary>
    public static string ReadAaddMd() => ReadEmbedded("aadd.md");

    /// <summary>The repo-root site changelog - see UpdateLogPageRenderer.</summary>
    public static string ReadUpdateLogMd() => ReadEmbedded("updatelog.md");

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
        var combined = ReadMainCss() + ReadMainJs() + ReadSokobanJs() + ReadPuzzleJs() + ReadBoardJs() + ReadShellJs()
            + string.Concat(PuzzleScriptParts.Concat(PageScriptParts).Select(ReadScriptPart));
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
