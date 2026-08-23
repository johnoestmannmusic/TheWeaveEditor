using TheWeave.Core.Model;

namespace TheWeave.EditorApp;

/// <summary>
/// Where a file picked via the Inspector's file dialog (e.g. "Browse..." for a cover image)
/// should end up relative to the project's content root. A file already inside that folder is
/// left referenced right where it is - whatever organization it already has is respected. One
/// picked from anywhere else is copied in under a predictable, organized path -
/// img/&lt;page&gt;/&lt;location-slug&gt;.&lt;ext&gt; - rather than just being referenced by its
/// original "../elsewhere/whatever.png" location: the exporter's AssetResolver can still cope
/// with a reference like that, but the project's own content folder would never actually gain
/// the file, and the path would read oddly in the Inspector from then on.
/// </summary>
internal static class AssetImport
{
    /// <param name="contentRoot">The project's content root (where img/, fnt/ live).</param>
    /// <param name="imgRoot">Project.Assets.ImgRoot, e.g. "img".</param>
    /// <param name="sourceAbsolute">The file the user picked, as an absolute path.</param>
    /// <param name="pageFolderId">
    /// The page the location being edited belongs to (its Id becomes the destination
    /// subfolder), or null if that context isn't available - falls back to "imported".
    /// </param>
    /// <param name="nodeSlug">
    /// The location's own Id (already a filesystem-safe slug), used as the destination
    /// filename so it reads sensibly - falls back to the source file's own name if null.
    /// </param>
    public static string ResolveDestination(
        string contentRoot, string imgRoot, string sourceAbsolute, string? pageFolderId, string? nodeSlug)
    {
        var relativeToContent = Path.GetRelativePath(contentRoot, sourceAbsolute).Replace('\\', '/');
        if (!relativeToContent.StartsWith("..") && !Path.IsPathRooted(relativeToContent))
            return relativeToContent;

        var folder = pageFolderId ?? "imported";
        var ext = Path.GetExtension(sourceAbsolute);
        var baseName = nodeSlug ?? Path.GetFileNameWithoutExtension(sourceAbsolute);

        return FindAvailableDestination(contentRoot, $"{imgRoot}/{folder}", baseName, ext, sourceAbsolute);
    }

    // Picks "<folder>/<baseName><ext>", or "<folder>/<baseName>-2<ext>" etc. if that name is
    // already taken by a genuinely different file - re-picking the very same source file
    // reuses its existing copy rather than creating a needless -2 duplicate of itself.
    internal static string FindAvailableDestination(
        string contentRoot, string folder, string baseName, string ext, string sourceAbsolute)
    {
        var candidate = $"{folder}/{baseName}{ext}";
        var n = 2;

        while (true)
        {
            var candidateAbsolute = Path.Combine(contentRoot, candidate.Replace('/', Path.DirectorySeparatorChar));
            if (!File.Exists(candidateAbsolute) || FilesAreIdentical(sourceAbsolute, candidateAbsolute))
                return candidate;

            candidate = $"{folder}/{baseName}-{n}{ext}";
            n++;
        }
    }

    /// <summary>
    /// Same idea as ResolveDestination, but for a single project-wide asset with no page/node
    /// to organize by (the shell's background music - see WeaveProject.BackgroundMusicPath).
    /// Lands directly at "&lt;root&gt;/&lt;original filename&gt;" rather than a per-page
    /// subfolder, and - since BackgroundMusicPath is stored relative to Assets.MusRoot itself,
    /// not to contentRoot - returns a path relative to root, not to contentRoot.
    /// </summary>
    public static string ResolveRootRelativeDestination(string contentRoot, string root, string sourceAbsolute)
    {
        var rootAbsolute = Path.GetFullPath(Path.Combine(contentRoot, root));
        var relativeToRoot = Path.GetRelativePath(rootAbsolute, sourceAbsolute).Replace('\\', '/');
        if (!relativeToRoot.StartsWith("..") && !Path.IsPathRooted(relativeToRoot))
            return relativeToRoot; // already inside root - reference it right where it is

        var ext = Path.GetExtension(sourceAbsolute);
        var baseName = Path.GetFileNameWithoutExtension(sourceAbsolute);
        var destRelativeToContent = FindAvailableDestination(contentRoot, root, baseName, ext, sourceAbsolute);
        return destRelativeToContent[(root.Length + 1)..]; // strip the "<root>/" prefix FindAvailableDestination always produces
    }

    private static bool FilesAreIdentical(string pathA, string pathB) =>
        File.ReadAllBytes(pathA).AsSpan().SequenceEqual(File.ReadAllBytes(pathB));

    /// <summary>
    /// Renaming a location's id keeps its own auto-organized cover image in sync, so the file
    /// keeps reading sensibly (img/index/salmon-town.png rather than a location called "The
    /// Salmon Districts" still pointing at .../salmon-town.png). Only renames the file - and
    /// only reports back a new path to store - when the cover clearly *is* that auto-organized
    /// file (its name, ignoring extension, is exactly the old id) and isn't shared with any
    /// other node's cover. A manually organized or intentionally shared cover is left alone;
    /// callers should keep Card.CoverImagePath as it already was when this returns null.
    /// </summary>
    public static string? RenameCoverImageIfOwned(string contentRoot, WeaveProject project, Node node, string oldId)
    {
        var coverPath = node.Card.CoverImagePath;
        if (string.IsNullOrEmpty(coverPath))
            return null;

        if (Path.GetFileNameWithoutExtension(coverPath) != oldId)
            return null;

        if (ProjectEditing.CountCoverImageReferences(project, coverPath) > 1)
            return null;

        var oldAbsolute = Path.GetFullPath(Path.Combine(contentRoot, coverPath.Replace('/', Path.DirectorySeparatorChar)));
        if (!File.Exists(oldAbsolute))
            return null;

        var folder = Path.GetDirectoryName(coverPath)?.Replace('\\', '/') ?? "";
        var ext = Path.GetExtension(coverPath);
        var newRelative = FindAvailableDestination(contentRoot, folder, node.Id, ext, oldAbsolute);

        var newAbsolute = Path.GetFullPath(Path.Combine(contentRoot, newRelative.Replace('/', Path.DirectorySeparatorChar)));
        var newDir = Path.GetDirectoryName(newAbsolute);
        if (!string.IsNullOrEmpty(newDir))
            Directory.CreateDirectory(newDir);

        File.Move(oldAbsolute, newAbsolute);
        return newRelative;
    }
}
