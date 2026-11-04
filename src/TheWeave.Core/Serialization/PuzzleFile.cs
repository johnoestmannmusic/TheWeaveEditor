using System.Text.Json;
using System.Text.Json.Serialization;
using TheWeave.Core.Model;

namespace TheWeave.Core.Serialization;

/// <summary>
/// A Sokoban puzzle's layout as a file of its own, for moving it from one track to another. What's on the
/// board goes in, along with any drawings from the project's library its objects use, so it can go to another
/// project too. A puzzle's colours and textures come from its track's album art, so they're worked out again
/// for whichever track it ends up on.
/// </summary>
public static class PuzzleFile
{
    private const string FormatName = "weave-sokoban-puzzle";
    private const int CurrentVersion = 1;

    private sealed class Contents
    {
        public string? Format { get; set; }
        public int Version { get; set; }
        public List<PuzzleObject>? Objects { get; set; }
        public List<PuzzleDrawing>? Drawings { get; set; }
    }

    public sealed record Layout(List<PuzzleObject> Objects, List<PuzzleDrawing> Drawings);

    private static readonly JsonSerializerOptions Options = new()
    {
        WriteIndented = true,
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    /// <param name="library">The project's drawings, for the ones the puzzle's objects use.</param>
    public static string Serialize(Puzzle puzzle, IEnumerable<PuzzleDrawing>? library = null)
    {
        var drawings = PuzzleDrawings.UsedBy(puzzle, library, includeStandard: false);
        return JsonSerializer.Serialize(new Contents
        {
            Format = FormatName,
            Version = CurrentVersion,
            Objects = puzzle.Objects,
            Drawings = drawings.Count > 0 ? drawings : null,
        }, Options);
    }

    /// <returns>The objects and drawings in the file. They still need checking against the rules for a board.</returns>
    /// <exception cref="InvalidDataException">The text isn't a puzzle file this version can read.</exception>
    public static Layout Parse(string json)
    {
        Contents? contents;
        try
        {
            contents = JsonSerializer.Deserialize<Contents>(json, Options);
        }
        catch (JsonException e)
        {
            throw new InvalidDataException($"This puzzle file can't be read: {e.Message}", e);
        }

        if (contents?.Format != FormatName)
            throw new InvalidDataException("This isn't a Sokoban puzzle file.");
        if (contents.Version > CurrentVersion)
            throw new InvalidDataException("This puzzle file was made by a newer version of the Editor.");

        return new Layout(contents.Objects ?? new List<PuzzleObject>(), contents.Drawings ?? new List<PuzzleDrawing>());
    }
}
