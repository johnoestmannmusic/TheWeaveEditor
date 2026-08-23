namespace TheWeave.Core.Model;

/// <summary>Where the shared runtime and asset roots live, relative to the exported site root.</summary>
public sealed class ProjectAssets
{
    public string CssPath { get; set; } = "css/main.css";
    public string JsPath { get; set; } = "jsx/main.js";
    public string ImgRoot { get; set; } = "img";
    public string FntRoot { get; set; } = "fnt";
    public string MusRoot { get; set; } = "mus";

    /// <summary>Where the shell's own script (see SiteExporter/ShellRenderer) is written.</summary>
    public string ShellJsPath { get; set; } = "jsx/shell.js";
}
