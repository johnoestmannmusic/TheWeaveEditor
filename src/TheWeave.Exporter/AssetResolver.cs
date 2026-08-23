namespace TheWeave.Exporter;

/// <summary>
/// Copies every image actually *referenced* by a project (page backgrounds, node cover
/// images, effect sprites) into the export and reports where each one landed, so the export
/// is genuinely self-contained regardless of where on disk a referenced file happens to live -
/// rather than relying on AssetCopier's wholesale copy of Assets.ImgRoot/FntRoot, which only
/// works when every reference already sits inside that tree at its own intended export path.
/// A cover image picked from outside the project's content folder is the case that exposed
/// this: its stored path climbs out via "../" and AssetCopier's wholesale mirror never sees it.
/// </summary>
public sealed class AssetResolver
{
    private readonly string _contentSourceRoot;
    private readonly string _outputDir;
    private readonly Dictionary<string, string> _resolved = new();
    private readonly HashSet<string> _usedDestinations = new(StringComparer.OrdinalIgnoreCase);
    private readonly HashSet<string> _realDestinations = new(StringComparer.OrdinalIgnoreCase);

    public AssetResolver(string contentSourceRoot, string outputDir)
    {
        _contentSourceRoot = contentSourceRoot;
        _outputDir = outputDir;
    }

    /// <summary>
    /// Every destination path (relative to outputDir) this resolver has produced for a
    /// reference that actually exists on disk - i.e. every path an export-cleanup pass should
    /// never remove as an orphan, whether or not this resolver did the copying itself (an
    /// already-in-tree reference is included too, since AssetCopier's wholesale mirror is
    /// expected to have written it).
    /// </summary>
    public IReadOnlyCollection<string> ResolvedDestinations => _realDestinations;

    /// <summary>
    /// Returns the path to use in the exported HTML/JSON for a referenced image, copying the
    /// source file into the export. The same input path always maps to the same output, so
    /// two nodes sharing a cover image only copy it once. Null/empty and absolute URLs
    /// (http/https/protocol-relative - i.e. not a local file at all) pass through unchanged.
    /// A reference that doesn't actually exist on disk also passes through unchanged - already
    /// broken, and not this method's job to diagnose.
    /// </summary>
    public string Resolve(string? path)
    {
        if (string.IsNullOrEmpty(path))
            return path ?? "";

        if (IsExternalUrl(path))
            return path;

        if (_resolved.TryGetValue(path, out var cached))
            return cached;

        var sourceAbsolute = Path.GetFullPath(Path.Combine(_contentSourceRoot, path));
        if (!File.Exists(sourceAbsolute))
        {
            _resolved[path] = path;
            return path;
        }

        var normalized = path.Replace('\\', '/');
        var destRelative = IsSafeRelativePath(normalized) ? normalized : MakeSafeDestination(normalized);

        var destAbsolute = Path.Combine(_outputDir, destRelative.Replace('/', Path.DirectorySeparatorChar));
        var destDir = Path.GetDirectoryName(destAbsolute);
        if (!string.IsNullOrEmpty(destDir))
            Directory.CreateDirectory(destDir);

        File.Copy(sourceAbsolute, destAbsolute, overwrite: true);

        _resolved[path] = destRelative;
        _realDestinations.Add(destRelative);
        return destRelative;
    }

    private static bool IsExternalUrl(string path) =>
        path.StartsWith("http://", StringComparison.OrdinalIgnoreCase) ||
        path.StartsWith("https://", StringComparison.OrdinalIgnoreCase) ||
        path.StartsWith("//", StringComparison.Ordinal);

    // A path is "safe" if it already resolves to somewhere inside the export tree at its own
    // name - i.e. it's an ordinary project-relative reference like "img/x/y.png". Anything that
    // climbs out via ".." (or is already rooted/absolute) needs remapping instead, since using
    // it as-is would write outside outputDir rather than into the packaged export.
    private static bool IsSafeRelativePath(string normalized) =>
        !Path.IsPathRooted(normalized) && !normalized.Split('/').Contains("..");

    private string MakeSafeDestination(string normalized)
    {
        var fileName = Path.GetFileName(normalized);
        var candidate = "img/imported/" + fileName;

        var n = 2;
        while (_usedDestinations.Contains(candidate))
        {
            candidate = $"img/imported/{Path.GetFileNameWithoutExtension(fileName)}-{n}{Path.GetExtension(fileName)}";
            n++;
        }

        _usedDestinations.Add(candidate);
        return candidate;
    }
}
