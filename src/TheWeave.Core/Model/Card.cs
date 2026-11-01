namespace TheWeave.Core.Model;

/// <summary>The two fixed card sizes seen in the real site today, plus an escape hatch.</summary>
public enum CardSize
{
    /// <summary>252x505 - the CSS default, used by ordinary location cards.</summary>
    Standard,

    /// <summary>512x460 - used by planet/sector hub cards (also shifts the heading and poetry text).</summary>
    Hub,

    Custom,

    /// <summary>
    /// A screen-centered popup with a dimmed backdrop (520x360 unless CustomWidthPx/HeightPx
    /// override it) - e.g. a tutorial/news card. Ignores its Node's X/Y and world position
    /// entirely: it's excluded from ship proximity,
    /// and its own map icon never renders. Shown automatically on load (via Node.Persistent,
    /// same as any other persistent card) and dismissed only by pressing Z/gamepad A - see
    /// main.js's modalQueue.
    /// </summary>
    Modal,
}

public enum ActionKind
{
    /// <summary>Informational only - e.g. the tutorial card. Interacting just toggles the card shut.</summary>
    None,

    /// <summary>Links out to the release/download page for this location's track.</summary>
    Download,

    /// <summary>Navigates to another Page in this project (a planet/sector hub card).</summary>
    Travel,
}

public sealed class AudioRef
{
    public string Url { get; set; } = "";
}

public sealed class CardAction
{
    public ActionKind Kind { get; set; } = ActionKind.None;

    /// <summary>Set when Kind == Download: the external release-page URL.</summary>
    public string? Url { get; set; }

    /// <summary>Set when Kind == Travel: the Id of the Page this node navigates to.</summary>
    public string? TargetPageId { get; set; }

    /// <summary>
    /// Optional: where the ship should spawn on the destination page (its world X/Y), instead
    /// of that page's own default start point. Null on either means "use the destination
    /// page's default." Mirrors the real site's ?x=..&amp;y=.. travel-link convention.
    /// </summary>
    public double? TravelSpawnX { get; set; }
    public double? TravelSpawnY { get; set; }

    /// <summary>If true, the destination page's tutorial/shrine intro card won't auto-open.</summary>
    public bool TravelSkipTutorial { get; set; }
}

/// <summary>The info panel a node reveals: cover, audio, title, verse, and an action.</summary>
public sealed class Card
{
    public CardSize Size { get; set; } = CardSize.Standard;
    public int? CustomWidthPx { get; set; }
    public int? CustomHeightPx { get; set; }

    /// <summary>Hand-tuned position of the card relative to its node's icon.</summary>
    public Offset Offset { get; set; } = new() { Top = -130, Left = 80 };

    public string? CoverImagePath { get; set; }
    public AudioRef? Audio { get; set; }

    public string HeadingText { get; set; } = "";

    /// <summary>Null = use the CSS default heading position. Hub cards override this.</summary>
    public Offset? HeadingOffset { get; set; }

    /// <summary>
    /// Each entry is one verse line, shown on the card itself for a travel or informational location,
    /// and only in Track Focus for a track. Supports a small safe markup subset:
    /// **bold** for &lt;b&gt;, literal &amp;nbsp;, and passthrough &lt;a href="..."&gt;...&lt;/a&gt; links.
    /// </summary>
    public List<string> PoetryLines { get; set; } = new();

    /// <summary>Null = use the CSS default poetry-text position. Hub cards override this.</summary>
    public Offset? PoetryOffset { get; set; }

    public CardAction Action { get; set; } = new();

    /// <summary>Rare: an always-visible secondary panel, e.g. the tutorial card's "Updates:" list.</summary>
    public List<StaticTextBlock> ExtraPanels { get; set; } = new();
}
