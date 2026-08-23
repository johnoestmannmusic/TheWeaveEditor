using System.Text.Json;

namespace TheWeave.EditorApp;

/// <summary>
/// Small persisted app-level settings (currently just "which project was open last"), stored
/// outside any project file so the editor can auto-load it on the next launch. Lives under the
/// OS's per-user config dir (~/.config/TheWeaveEditor on Linux, %AppData%\TheWeaveEditor on
/// Windows) via SpecialFolder.ApplicationData - separate from the project files themselves,
/// which the user places wherever they like.
/// </summary>
public sealed class EditorSettings
{
    public string? LastProjectPath { get; set; }

    private static string FilePath =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "TheWeaveEditor", "settings.json");

    public static EditorSettings Load()
    {
        try
        {
            var path = FilePath;
            if (!File.Exists(path))
                return new EditorSettings();

            return JsonSerializer.Deserialize<EditorSettings>(File.ReadAllText(path)) ?? new EditorSettings();
        }
        catch
        {
            // A corrupt or unreadable settings file shouldn't block the app from starting.
            return new EditorSettings();
        }
    }

    public void Save()
    {
        try
        {
            var path = FilePath;
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.WriteAllText(path, JsonSerializer.Serialize(this));
        }
        catch
        {
            // Best-effort - losing the "last project" convenience isn't worth surfacing an error.
        }
    }
}
