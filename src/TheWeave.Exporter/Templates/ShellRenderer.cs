using System.Net;
using System.Text;
using TheWeave.Core.Model;

namespace TheWeave.Exporter.Templates;

/// <summary>
/// Renders the site's persistent shell (written to index.html) - a full-viewport iframe that
/// every actual page loads into, plus a looping "hub theme" track (see runtime/shell.js) that
/// survives travel between pages since the iframe, not the shell document, is what reloads.
/// Its volume depends on where the visitor is, not constant - see shell.js's bindBackgroundMusic.
/// Only ever called when WeaveProject.HomePageId is set; see SiteExporter.
/// </summary>
public static class ShellRenderer
{
    public static string Render(WeaveProject project, string homePageFileName)
    {
        var sb = new StringBuilder();

        sb.AppendLine("<!DOCTYPE html>");
        sb.AppendLine("<html><head>");
        sb.AppendLine("<meta http-equiv=\"content-type\" content=\"text/html; charset=UTF-8\">");
        sb.AppendLine("  <meta charset=\"utf-8\">");
        sb.AppendLine("  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1, shrink-to-fit=no\">");
        sb.AppendLine($"  <title>{EscapeText(project.Title)}</title>");
        sb.AppendLine("  <style>");
        sb.AppendLine("    html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #000; }");
        sb.AppendLine("    #weaveStage { display: block; width: 100%; height: 100%; border: 0; }");
        sb.AppendLine("  </style>");
        sb.AppendLine($"  <script src=\"{EscapeAttr(project.Assets.ShellJsPath)}?v={RuntimeAssets.Version}\"></script>");
        sb.AppendLine("</head>");
        sb.AppendLine();
        sb.AppendLine("<body>");
        sb.AppendLine();

        if (project.BackgroundMusicPath is not null)
        {
            // No longer a constant site-wide loop - shell.js now drives this element's volume
            // from a per-frame 'weave-hub-music' signal main.js computes (see its
            // updateHubMusicSignal): full ambient volume while the visitor is actually on the
            // home page, or on the square of a node elsewhere that travels back to it.
            var musicSrc = $"{project.Assets.MusRoot}/{project.BackgroundMusicPath}";
            sb.AppendLine($"  <audio id=\"weaveBgMusic\" src=\"{EscapeAttr(musicSrc)}\" loop preload=\"auto\"></audio>");
        }

        sb.AppendLine($"  <iframe id=\"weaveStage\" src=\"{EscapeAttr(homePageFileName)}\" allow=\"autoplay; gamepad\"></iframe>");
        sb.AppendLine();
        sb.AppendLine("</body>");
        sb.AppendLine("</html>");

        return sb.ToString();
    }

    private static string EscapeText(string value) => WebUtility.HtmlEncode(value);

    private static string EscapeAttr(string value) => WebUtility.HtmlEncode(value);
}
