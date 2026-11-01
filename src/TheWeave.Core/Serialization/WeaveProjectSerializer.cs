using System.Text.Json;
using TheWeave.Core.Model;

namespace TheWeave.Core.Serialization;

/// <summary>
/// Reads/writes a WeaveProject as JSON. PascalCase property names are kept (no camelCase
/// policy) so the file mirrors the C# model 1:1 - easier to hand-edit and to diff in git.
/// </summary>
public static class WeaveProjectSerializer
{
    private static readonly JsonSerializerOptions Options = new()
    {
        WriteIndented = true,
    };

    public static string Serialize(WeaveProject project) =>
        JsonSerializer.Serialize(project, Options);

    public static WeaveProject Deserialize(string json) => Deserialize(json, out _);

    /// <param name="upgradeNotes">What ProjectMigrations.Upgrade reported - null if nothing needed upgrading.</param>
    public static WeaveProject Deserialize(string json, out List<string>? upgradeNotes)
    {
        var project = JsonSerializer.Deserialize<WeaveProject>(json, Options)
            ?? throw new InvalidDataException("Project file is empty or invalid.");
        upgradeNotes = ProjectMigrations.Upgrade(project);
        return project;
    }

    /// <summary>The version a project file was saved at, without upgrading it - see ProjectMigrations.</summary>
    public static int ReadSchemaVersion(string path)
    {
        using var document = JsonDocument.Parse(File.ReadAllText(path));
        return document.RootElement.TryGetProperty(nameof(WeaveProject.SchemaVersion), out var version)
            ? version.GetInt32()
            : ProjectMigrations.CurrentSchemaVersion;
    }

    public static void SaveToFile(WeaveProject project, string path) =>
        File.WriteAllText(path, Serialize(project));

    public static WeaveProject LoadFromFile(string path) => LoadFromFile(path, out _);

    public static WeaveProject LoadFromFile(string path, out List<string>? upgradeNotes) =>
        Deserialize(File.ReadAllText(path), out upgradeNotes);
}
