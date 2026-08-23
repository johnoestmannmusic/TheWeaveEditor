using TheWeave.Core.Model;

namespace TheWeave.Exporter;

/// <summary>Writes the shared runtime and copies content assets (img/, fnt/) into an export.</summary>
public static class AssetCopier
{
    /// <returns>The paths written, relative to outputDir - callers use this to know what an
    /// export-cleanup pass should never touch.</returns>
    public static IReadOnlyCollection<string> CopyRuntime(WeaveProject project, string outputDir)
    {
        WriteFile(Path.Combine(outputDir, project.Assets.CssPath), RuntimeAssets.ReadMainCss());
        WriteFile(Path.Combine(outputDir, project.Assets.JsPath), RuntimeAssets.ReadMainJs());
        WriteFile(Path.Combine(outputDir, project.Assets.ShellJsPath), RuntimeAssets.ReadShellJs());
        return new[] { Normalize(project.Assets.CssPath), Normalize(project.Assets.JsPath), Normalize(project.Assets.ShellJsPath) };
    }

    /// <summary>
    /// Copies img/, fnt/, and mus/ (as configured on the project) from wherever the project's
    /// content assets actually live on disk into the export output directory.
    /// </summary>
    /// <returns>Every path copied, relative to outputDir.</returns>
    public static IReadOnlyCollection<string> CopyContentAssets(WeaveProject project, string contentSourceRoot, string outputDir)
    {
        var written = new List<string>();

        CopyDirectoryIfExists(
            Path.Combine(contentSourceRoot, project.Assets.ImgRoot),
            Path.Combine(outputDir, project.Assets.ImgRoot),
            outputDir, written);

        CopyDirectoryIfExists(
            Path.Combine(contentSourceRoot, project.Assets.FntRoot),
            Path.Combine(outputDir, project.Assets.FntRoot),
            outputDir, written);

        CopyDirectoryIfExists(
            Path.Combine(contentSourceRoot, project.Assets.MusRoot),
            Path.Combine(outputDir, project.Assets.MusRoot),
            outputDir, written);

        return written;
    }

    private static void WriteFile(string path, string content)
    {
        var dir = Path.GetDirectoryName(path);
        if (!string.IsNullOrEmpty(dir))
            Directory.CreateDirectory(dir);

        File.WriteAllText(path, content);
    }

    private static void CopyDirectoryIfExists(string sourceDir, string destDir, string outputDir, List<string> written)
    {
        if (!Directory.Exists(sourceDir))
            return;

        Directory.CreateDirectory(destDir);

        foreach (var file in Directory.EnumerateFiles(sourceDir, "*", SearchOption.AllDirectories))
        {
            var relative = Path.GetRelativePath(sourceDir, file);
            var destPath = Path.Combine(destDir, relative);

            var destFileDir = Path.GetDirectoryName(destPath);
            if (!string.IsNullOrEmpty(destFileDir))
                Directory.CreateDirectory(destFileDir);

            File.Copy(file, destPath, overwrite: true);
            written.Add(Normalize(Path.GetRelativePath(outputDir, destPath)));
        }
    }

    private static string Normalize(string relativePath) => relativePath.Replace('\\', '/');
}
