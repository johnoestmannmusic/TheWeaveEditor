using System.Text.Json;
using System.Text.Json.Serialization;
using TheWeave.Core.Model;

namespace TheWeave.Core.Serialization;

/// <summary>
/// A Sokoban puzzle's layout as a file of its own, for moving it from one track to another. Only what's on
/// the board goes in: a puzzle's colours and textures come from its track's album art, so they're worked out
/// again for whichever track it ends up on.
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
    }

    private static readonly JsonSerializerOptions Options = new()
    {
        WriteIndented = true,
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public static string Serialize(Puzzle puzzle) =>
        JsonSerializer.Serialize(new Contents { Format = FormatName, Version = CurrentVersion, Objects = puzzle.Objects }, Options);

    /// <returns>The objects in the file. They still need checking against the rules for a board.</returns>
    /// <exception cref="InvalidDataException">The text isn't a puzzle file this version can read.</exception>
    public static List<PuzzleObject> Parse(string json)
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

        return contents.Objects ?? new List<PuzzleObject>();
    }
}
