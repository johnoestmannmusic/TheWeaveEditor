namespace TheWeave.Core.Model;

/// <summary>
/// A location's stages: the puzzles that have to be solved to complete it, its own and every part's, in the order
/// they're played. Only ones that can really be played and solved count - a puzzle on a track with Track Focus and
/// album art (see PageRenderer.BuildPuzzleAttr), with a Finish - the same ones that hold a location's later parts
/// back in runtime/main.js's partLockedBy.
/// </summary>
public static class PuzzleStages
{
    /// <summary>The ids of a location's stages, which are also its puzzles' ids in the exported site.</summary>
    public static List<string> Of(Node node)
    {
        var stages = new List<string>();
        Collect(node, stages);
        return stages;
    }

    /// <summary>Whether a track's puzzle can be played: it needs Track Focus, and album art to play it over.</summary>
    public static bool IsPlayable(Node node) =>
        node.Puzzle is not null && OpensTrackFocus(node.Card) && !string.IsNullOrEmpty(node.Card.CoverImagePath);

    public static bool OpensTrackFocus(Card card) =>
        card.Audio is not null && card.Action.Kind != ActionKind.Travel && card.Size != CardSize.Modal;

    private static void Collect(Node node, List<string> stages)
    {
        if (IsPlayable(node) && node.Puzzle!.Objects.Any(o => o.Kind == PuzzleObjectKind.Finish))
            stages.Add(node.Id);
        foreach (var child in node.Children)
            Collect(child, stages);
    }
}
