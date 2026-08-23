namespace TheWeave.EditorApp;

/// <summary>
/// The flat union of every possible JS->C# request shape. Only the fields relevant to
/// `Type` are populated for any given message; unused fields stay null/default.
/// </summary>
public sealed class EditorMessage
{
    public string Type { get; set; } = "";
    public string? PageId { get; set; }
    public string? NodeId { get; set; }
    public string? ParentNodeId { get; set; }
    public PageEditRequest? Page { get; set; }
    public NodeEditRequest? Node { get; set; }
    public ProjectEditRequest? Project { get; set; }
    public string? EffectId { get; set; }
    public EffectEditRequest? Effect { get; set; }
    public TutorialModalEditRequest? TutorialModal { get; set; }

    /// <summary>Used only by "add-node": where on the canvas the new node was placed.</summary>
    public double? X { get; set; }
    public double? Y { get; set; }

    /// <summary>Used only by "rename-node-id": the requested new id for NodeId.</summary>
    public string? NewId { get; set; }
}

public sealed class PageEditRequest
{
    /// <summary>Present only for "add-page" as a seed for id generation (usually the title).</summary>
    public string? Title { get; set; }
    public string? OutputFileName { get; set; }
    public string? BackgroundImagePath { get; set; }

    /// <summary>Null means "leave as-is" (matches the other fields' partial-update semantics).</summary>
    public bool? Wraps { get; set; }

    /// <summary>Null means "leave as-is" (matches the other fields' partial-update semantics).</summary>
    public bool? GlobeEffect { get; set; }

    /// <summary>
    /// Null means "leave as-is". True sets this page as WeaveProject.HomePageId (the shell's
    /// default iframe target); false clears HomePageId, but only if it was already this page -
    /// see ProjectEditing.ApplyPageEdit.
    /// </summary>
    public bool? IsHome { get; set; }

    /// <summary>Always applied verbatim (null clears it) - see Page.DefaultSpawnX/Y's own doc.</summary>
    public double? DefaultSpawnX { get; set; }
    public double? DefaultSpawnY { get; set; }
}

/// <summary>Project-level settings editable from the UI - currently just the shell's looping
/// background track (relative to Assets.MusRoot). A blank value clears it back to null, same
/// as an Inspector text field's own convention (see ApplyNodeEdit's CoverImagePath handling).</summary>
public sealed class ProjectEditRequest
{
    public string? BackgroundMusicPath { get; set; }
}

/// <summary>
/// Everything the Inspector's node form currently edits. Deliberately doesn't cover
/// Card.Offset/HeadingOffset/PoetryOffset/ExtraPanels (untouched by applying this) - visual
/// positioning is the map canvas's job (a later milestone), and ExtraPanels are rare enough
/// (one real occurrence sitewide) to not need editor UI yet.
/// </summary>
public sealed class NodeEditRequest
{
    public double X { get; set; }
    public double Y { get; set; }
    public bool Persistent { get; set; }
    public string IconStyle { get; set; } = "Default";
    public string CardSize { get; set; } = "Standard";
    public int? CustomWidthPx { get; set; }
    public int? CustomHeightPx { get; set; }
    public string HeadingText { get; set; } = "";
    public string? CoverImagePath { get; set; }
    public string? AudioUrl { get; set; }
    public List<string> PoetryLines { get; set; } = new();
    public string ActionKind { get; set; } = "None";
    public string? ActionUrl { get; set; }
    public string? TargetPageId { get; set; }
    public double? TravelSpawnX { get; set; }
    public double? TravelSpawnY { get; set; }
    public bool TravelSkipTutorial { get; set; }
}

/// <summary>
/// A flat union covering both PageEffect subtypes, so the Inspector's effect form (and the
/// C# side) only need to deal with one shape. Kind selects which fields matter: "Crossfade"
/// uses ImagePath/Opacity*/Duration/Direction/Easing; "Drift" uses ImagePath/X/Y/BlendMode
/// and the DriftX*/DriftY* groups (each independently optional via HasDriftX/HasDriftY).
/// </summary>
public sealed class EffectEditRequest
{
    public string Kind { get; set; } = "Crossfade";
    public string ImagePath { get; set; } = "";

    // Crossfade only
    public double OpacityFrom { get; set; }
    public double OpacityTo { get; set; }
    public int DurationMs { get; set; } = 1000;
    public string Direction { get; set; } = "alternate";
    public string Easing { get; set; } = "ease-in-out";

    // Drift only
    public double X { get; set; }
    public double Y { get; set; }
    public string? BlendMode { get; set; }

    public bool HasDriftX { get; set; }
    public double DriftXFromPx { get; set; }
    public double DriftXToPx { get; set; }
    public int DriftXDurationMs { get; set; } = 1000;
    public string DriftXDirection { get; set; } = "alternate-reverse";
    public string DriftXEasing { get; set; } = "ease-in-out";

    public bool HasDriftY { get; set; }
    public double DriftYFromPx { get; set; }
    public double DriftYToPx { get; set; }
    public int DriftYDurationMs { get; set; } = 1000;
    public string DriftYDirection { get; set; } = "alternate";
    public string DriftYEasing { get; set; } = "ease-in-out";
}

/// <summary>
/// Everything the Inspector's dedicated "Tutorial Modal" tab edits - the one CardSize.Modal
/// node on the project's home page (see ProjectEditing.FindTutorialModalNode/
/// ApplyTutorialModalEdit), plus its own "Updates:" panel (Card.ExtraPanels[0] - created if it
/// doesn't exist yet). That node is otherwise deliberately hidden from the tree/canvas - it
/// isn't a real world location (see main.js's modalQueue), so editing it through the generic
/// Node form read like a location it isn't.
/// </summary>
public sealed class TutorialModalEditRequest
{
    public string HeadingText { get; set; } = "";
    public string? CoverImagePath { get; set; }
    public string? AudioUrl { get; set; }
    public List<string> PoetryLines { get; set; } = new();
    public string UpdatesHeadingText { get; set; } = "";
    public List<string> UpdatesLines { get; set; } = new();
}
