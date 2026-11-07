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
        WriteFile(Path.Combine(outputDir, project.Assets.SokobanJsPath), RuntimeAssets.ReadSokobanJs());
        WriteFile(Path.Combine(outputDir, project.Assets.PuzzleJsPath), RuntimeAssets.ReadPuzzleJs());
        WriteFile(Path.Combine(outputDir, project.Assets.BoardJsPath), RuntimeAssets.ReadBoardJs());
        WriteFile(Path.Combine(outputDir, project.Assets.ShellJsPath), RuntimeAssets.ReadShellJs());

        // The parts puzzle.js and main.js are split into, beside them.
        var parts = RuntimeAssets.PuzzleScriptParts.Select(name => RuntimeAssets.Beside(project.Assets.PuzzleJsPath, name))
            .Zip(RuntimeAssets.PuzzleScriptParts)
            .Concat(RuntimeAssets.PageScriptParts.Select(name => RuntimeAssets.Beside(project.Assets.JsPath, name)).Zip(RuntimeAssets.PageScriptParts))
            .ToList();
        foreach (var (path, name) in parts)
            WriteFile(Path.Combine(outputDir, path), RuntimeAssets.ReadScriptPart(name));

        return new[] { Normalize(project.Assets.CssPath), Normalize(project.Assets.JsPath), Normalize(project.Assets.SokobanJsPath), Normalize(project.Assets.PuzzleJsPath), Normalize(project.Assets.BoardJsPath), Normalize(project.Assets.ShellJsPath) }
            .Concat(parts.Select(part => Normalize(part.Item1)))
            .ToArray();
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
