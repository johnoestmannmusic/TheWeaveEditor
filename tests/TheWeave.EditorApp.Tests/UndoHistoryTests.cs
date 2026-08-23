using TheWeave.Core.Model;
using TheWeave.EditorApp;
using Xunit;

namespace TheWeave.EditorApp.Tests;

public class UndoHistoryTests
{
    private static WeaveProject MakeProject(string title) => new() { Title = title };

    [Fact]
    public void Undo_RestoresThePreviousState()
    {
        var history = new UndoHistory();
        var original = MakeProject("Original");

        history.RecordBeforeChange(original);
        var edited = MakeProject("Edited");

        var restored = history.Undo(edited);

        Assert.NotNull(restored);
        Assert.Equal("Original", restored!.Title);
        Assert.False(history.CanUndo);
    }

    [Fact]
    public void Undo_WithNothingRecorded_ReturnsNull()
    {
        var history = new UndoHistory();
        Assert.Null(history.Undo(MakeProject("Current")));
    }

    [Fact]
    public void UndoThenRedo_RestoresTheStateThatWasUndone()
    {
        var history = new UndoHistory();
        var original = MakeProject("Original");
        history.RecordBeforeChange(original);
        var edited = MakeProject("Edited");

        var afterUndo = history.Undo(edited)!;
        var afterRedo = history.Redo(afterUndo);

        Assert.NotNull(afterRedo);
        Assert.Equal("Edited", afterRedo!.Title);
        Assert.False(history.CanRedo);
    }

    [Fact]
    public void RecordBeforeChange_ClearsRedoHistory_SinceANewEditInvalidatesIt()
    {
        var history = new UndoHistory();
        history.RecordBeforeChange(MakeProject("A"));
        var afterUndo = history.Undo(MakeProject("B"))!;
        Assert.True(history.CanRedo);

        history.RecordBeforeChange(afterUndo); // a fresh edit after undoing

        Assert.False(history.CanRedo);
    }

    [Fact]
    public void RecordBeforeChange_CapsAtTenEntries()
    {
        var history = new UndoHistory();

        for (var i = 0; i < 15; i++)
            history.RecordBeforeChange(MakeProject($"State {i}"));

        Assert.Equal(10, history.UndoStack.Count);
        // The oldest 5 (states 0-4) should have been dropped - the remaining oldest is state 5.
        Assert.Contains("State 5", history.UndoStack[0]);
        Assert.Contains("State 14", history.UndoStack[^1]);
    }

    [Fact]
    public void SaveThenLoad_RoundTripsTheHistoryForTheSameProjectPath()
    {
        using var tempHome = new TempHomeDirectory();

        var projectPath = Path.Combine(Path.GetTempPath(), $"weave-undo-test-{Guid.NewGuid():N}.json");
        var history = new UndoHistory();
        history.RecordBeforeChange(MakeProject("Original"));

        history.Save(projectPath);
        var loaded = UndoHistory.Load(projectPath);

        Assert.True(loaded.CanUndo);
        var restored = loaded.Undo(MakeProject("Current"));
        Assert.Equal("Original", restored!.Title);
    }

    [Fact]
    public void Load_ForAPathWithNoSavedHistory_ReturnsAnEmptyHistory()
    {
        var history = UndoHistory.Load($"/nonexistent/{Guid.NewGuid():N}/project.json");
        Assert.False(history.CanUndo);
        Assert.False(history.CanRedo);
    }

    // Redirects HOME/APPDATA so this test doesn't read or write the real user's undo history
    // directory.
    private sealed class TempHomeDirectory : IDisposable
    {
        private readonly string? _originalAppData = Environment.GetEnvironmentVariable("APPDATA");
        private readonly string? _originalXdgConfigHome = Environment.GetEnvironmentVariable("XDG_CONFIG_HOME");
        private readonly string _tempDir = Path.Combine(Path.GetTempPath(), $"weave-undo-home-{Guid.NewGuid():N}");

        public TempHomeDirectory()
        {
            Directory.CreateDirectory(_tempDir);
            Environment.SetEnvironmentVariable("XDG_CONFIG_HOME", _tempDir);
            Environment.SetEnvironmentVariable("APPDATA", _tempDir);
        }

        public void Dispose()
        {
            Environment.SetEnvironmentVariable("XDG_CONFIG_HOME", _originalXdgConfigHome);
            Environment.SetEnvironmentVariable("APPDATA", _originalAppData);
            if (Directory.Exists(_tempDir))
                Directory.Delete(_tempDir, recursive: true);
        }
    }
}
