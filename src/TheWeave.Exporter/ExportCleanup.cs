using TheWeave.Core.Model;

namespace TheWeave.Exporter;

/// <summary>
/// Removes files left over in an export from a previous run that this run didn't (re)write -
/// a renamed/deleted page's stale .html file, an old cover image that's no longer referenced
/// anywhere, etc. - so re-exporting to the same folder repeatedly doesn't accumulate orphans.
///
/// Deliberately scoped rather than wiping the whole output directory first: a user picks an
/// arbitrary folder for "Export Site", and blindly clearing it would be destructive if that
/// folder ever contained anything else (many static-site tools do wipe their output directory,
/// but they own a build config that makes that folder's purpose unambiguous - here it's a
/// folder picked once through a file dialog with no such guarantee). Given this site's actual
/// size, a full re-render on every export is already effectively instant either way, so there's
/// no efficiency case for the riskier approach - only cleanup ever needs scoping down.
/// Cleanup only ever touches: page .html files directly in outputDir's top level, and files
/// inside the project's own configured img/fnt/css/jsx subtrees. Nothing else in outputDir -
/// an unrelated file or folder the user happens to keep there - is ever considered.
/// </summary>
public static class ExportCleanup
{
    public static void RemoveOrphans(string outputDir, WeaveProject project, IReadOnlySet<string> writtenRelativePaths)
    {
        foreach (var htmlFile in Directory.EnumerateFiles(outputDir, "*.html", SearchOption.TopDirectoryOnly))
        {
            if (!writtenRelativePaths.Contains(Path.GetFileName(htmlFile)))
                File.Delete(htmlFile);
        }

        var scopedDirs = new[]
            {
                project.Assets.ImgRoot,
                project.Assets.FntRoot,
                project.Assets.MusRoot,
                TopSegment(project.Assets.CssPath),
                TopSegment(project.Assets.JsPath),
                TopSegment(project.Assets.ShellJsPath),
            }
            .Where(d => !string.IsNullOrEmpty(d))
            .Distinct(StringComparer.OrdinalIgnoreCase);

        foreach (var dir in scopedDirs)
        {
            var fullDir = Path.Combine(outputDir, dir);
            if (!Directory.Exists(fullDir))
                continue;

            foreach (var file in Directory.EnumerateFiles(fullDir, "*", SearchOption.AllDirectories))
            {
                var relative = Path.GetRelativePath(outputDir, file).Replace('\\', '/');
                if (!writtenRelativePaths.Contains(relative))
                    File.Delete(file);
            }

            RemoveEmptySubdirectories(fullDir);
        }
    }

    private static string TopSegment(string relativePath) =>
        relativePath.Replace('\\', '/').Split('/')[0];

    private static void RemoveEmptySubdirectories(string dir)
    {
        foreach (var sub in Directory.EnumerateDirectories(dir))
        {
            RemoveEmptySubdirectories(sub);
            if (!Directory.EnumerateFileSystemEntries(sub).Any())
                Directory.Delete(sub);
        }
    }
}
