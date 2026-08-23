using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using TheWeave.Core.Model;
using TheWeave.Core.Serialization;

namespace TheWeave.EditorApp;

/// <summary>
/// Bounded undo/redo history for a project, kept as full JSON snapshots rather than tracking a
/// reverse-operation per edit type - consistent with this app's existing "just resync the whole
/// state" philosophy (see Program.cs's header comment), and far simpler than hand-writing an
/// inverse for every one of the ~10 mutation kinds. Project sizes here (tens to low hundreds of
/// nodes) make holding up to 10 full snapshots cheap.
///
/// Persisted to a sidecar file under the app's own settings directory (not inside the project
/// file itself, so undo survives closing and reopening the editor without the project's own
/// on-disk schema gaining editor-only bookkeeping), keyed by a hash of the project's path so
/// each project gets its own independent history.
/// </summary>
public sealed class UndoHistory
{
    private const int MaxEntries = 10;

    public List<string> UndoStack { get; set; } = new();
    public List<string> RedoStack { get; set; } = new();

    public bool CanUndo => UndoStack.Count > 0;
    public bool CanRedo => RedoStack.Count > 0;

    /// <summary>Call with the project's state just *before* applying a mutation to it.</summary>
    public void RecordBeforeChange(WeaveProject projectBeforeChange)
    {
        Push(UndoStack, WeaveProjectSerializer.Serialize(projectBeforeChange));
        RedoStack.Clear(); // a fresh edit invalidates whatever redo history existed
    }

    /// <returns>The project state to restore, or null if there was nothing to undo.</returns>
    public WeaveProject? Undo(WeaveProject currentProject) => Move(UndoStack, RedoStack, currentProject);

    /// <returns>The project state to restore, or null if there was nothing to redo.</returns>
    public WeaveProject? Redo(WeaveProject currentProject) => Move(RedoStack, UndoStack, currentProject);

    private static WeaveProject? Move(List<string> from, List<string> to, WeaveProject currentProject)
    {
        if (from.Count == 0)
            return null;

        var snapshot = from[^1];
        from.RemoveAt(from.Count - 1);
        Push(to, WeaveProjectSerializer.Serialize(currentProject));
        return WeaveProjectSerializer.Deserialize(snapshot);
    }

    private static void Push(List<string> stack, string snapshot)
    {
        stack.Add(snapshot);
        if (stack.Count > MaxEntries)
            stack.RemoveAt(0);
    }

    public static UndoHistory Load(string projectPath)
    {
        try
        {
            var path = FilePathFor(projectPath);
            if (!File.Exists(path))
                return new UndoHistory();

            return JsonSerializer.Deserialize<UndoHistory>(File.ReadAllText(path)) ?? new UndoHistory();
        }
        catch
        {
            // A corrupt or unreadable history file shouldn't block opening the project.
            return new UndoHistory();
        }
    }

    public void Save(string projectPath)
    {
        try
        {
            var path = FilePathFor(projectPath);
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.WriteAllText(path, JsonSerializer.Serialize(this));
        }
        catch
        {
            // Best-effort, same as EditorSettings - losing undo history isn't worth surfacing.
        }
    }

    private static string FilePathFor(string projectPath)
    {
        var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "TheWeaveEditor", "undo");
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(Path.GetFullPath(projectPath))))[..16].ToLowerInvariant();
        return Path.Combine(dir, $"{hash}.json");
    }
}
