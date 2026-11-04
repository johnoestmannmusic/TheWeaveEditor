using System.Globalization;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using TheWeave.Core.Model;
using TheWeave.Exporter;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace TheWeave.Exporter.Templates;

/// <summary>
/// Renders a single Page to the same kind of static HTML the site is hand-authored in today:
/// one .node div per location (recursively, for nested story chains), each with a .floatInfo
/// card (cover, audio, heading, poetry lines, a download/travel action).
/// </summary>
public sealed class PageRenderer
{
    private static readonly Regex BoldPattern = new(@"\*\*(.+?)\*\*", RegexOptions.Compiled);

    /// <summary>
    /// The persistent shell (see ShellRenderer) needs to own the site's actual index.html, so
    /// whichever page is WeaveProject.HomePageId is always written under this fixed name
    /// instead of its own configured OutputFileName - see OutputFileNameFor.
    /// </summary>
    public const string HomePageFileName = "theweave.html";

    private readonly WeaveProject _project;
    private readonly Dictionary<string, string> _pageFileNamesById;
    private readonly AssetResolver? _assets;

    public PageRenderer(WeaveProject project, AssetResolver? assetResolver = null)
    {
        _project = project;
        _pageFileNamesById = project.Pages.ToDictionary(p => p.Id, p => OutputFileNameFor(p, project));
        _assets = assetResolver;
    }

    /// <summary>
    /// The file this page actually ends up at in the export - its own configured
    /// OutputFileName, unless it's the project's designated home page, in which case the
    /// shell's fixed HomePageFileName wins instead (see HomePageFileName's own doc).
    /// </summary>
    public static string OutputFileNameFor(Page page, WeaveProject project) =>
        project.HomePageId is not null && page.Id == project.HomePageId
            ? HomePageFileName
            : page.OutputFileName;

    // Copies the referenced file into the export (if needed) and returns the path to emit -
    // a no-op passthrough when no resolver was given (e.g. tests that only care about markup).
    private string ResolveAsset(string? path) => _assets?.Resolve(path) ?? (path ?? "");

    public string RenderPage(Page page)
    {
        var sb = new StringBuilder();

        sb.AppendLine("<!DOCTYPE html>");
        sb.AppendLine("<html><head>");
        sb.AppendLine("<meta http-equiv=\"content-type\" content=\"text/html; charset=UTF-8\">");
        sb.AppendLine("  <meta charset=\"utf-8\">");
        sb.AppendLine("  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1, shrink-to-fit=no\">");
        sb.AppendLine($"  <title>{EscapeText(page.Title)}</title>");
        sb.AppendLine($"  <link href=\"{EscapeAttr(_project.Assets.CssPath)}?v={RuntimeAssets.Version}\" rel=\"stylesheet\">");
        sb.AppendLine($"  <script src=\"{EscapeAttr(_project.Assets.SokobanJsPath)}?v={RuntimeAssets.Version}\"></script>");
        sb.AppendLine($"  <script src=\"{EscapeAttr(_project.Assets.PuzzleJsPath)}?v={RuntimeAssets.Version}\"></script>");
        sb.AppendLine($"  <script src=\"{EscapeAttr(_project.Assets.JsPath)}?v={RuntimeAssets.Version}\"></script>");
        sb.AppendLine();
        sb.AppendLine(PageConfigScriptRenderer.Render(page, _project));
        sb.AppendLine("  </head>");
        sb.AppendLine();
        sb.AppendLine("  <body>");
        sb.AppendLine();
        // First in the page, so that it's what the very first frame shows - see main.js's loading screen.
        sb.AppendLine("    <div id=\"loadingScreen\"><div id=\"loadingPanel\"><div id=\"loadingLabel\">Entering..</div><div id=\"loadingBar\"><div id=\"loadingFill\"></div></div></div></div>");
        sb.AppendLine();
        sb.AppendLine("    <!-- Background -->");
        sb.AppendLine($"     <img id=\"bgmap\" class=\"pannable\" src=\"{EscapeAttr(ResolveAsset(page.Background.ImagePath))}\">");

        if (page.SecondaryBackground is not null)
            sb.AppendLine($"     <img id=\"bgmap2\" class=\"pannable\" src=\"{EscapeAttr(ResolveAsset(page.SecondaryBackground.ImagePath))}\" style=\"opacity:0%;\">");

        sb.AppendLine();
        sb.AppendLine("    <!-- Interactables -->");
        sb.AppendLine();

        foreach (var node in page.Nodes)
            RenderNode(sb, page, node, isNested: false, indent: 4);

        var effectsScript = EffectsScriptRenderer.Render(page.Effects, _assets);
        if (effectsScript is not null)
        {
            sb.AppendLine(effectsScript);
            sb.AppendLine();
        }

        sb.AppendLine("  </body>");
        sb.AppendLine();
        sb.AppendLine("  </html>");

        return sb.ToString();
    }

    private void RenderNode(StringBuilder sb, Page sourcePage, Node node, bool isNested, int indent)
    {
        var pad = new string(' ', indent);

        // A nested node isn't a place on the map: nothing of it is visible, and its stored X/Y mean
        // nothing. It's only here for main.js to read when Track Focus reaches it.
        var left = isNested ? 0 : node.X;
        var top = isNested ? 0 : node.Y;

        var iconSrc = node.IconStyle == IconStyle.Race ? "img/node-race.png" : "img/node.png";
        var persistentAttr = node.Persistent ? " data-persistent=\"true\"" : "";
        // Node.Id is otherwise never exposed in the exported HTML (it's purely an internal
        // project-file slug - see the README's node-nesting section) - a modal card is the one
        // exception, needing a *stable* identity across page loads so main.js can remember (via
        // sessionStorage) that this particular one has already been dismissed once this session.
        var modalAttr = node.Card.Size == CardSize.Modal
            ? $" data-modal=\"true\" data-modal-id=\"{EscapeAttr(node.Id)}\""
            : "";

        // Marks a node whose Travel action leads back to the project's home page - main.js's
        // updateHubMusicSignal uses this to fade the shell's hub theme in as the ship
        // approaches one, the same way it fades a location's own track in (see
        // WeaveProject.BackgroundMusicPath's own doc).
        var travelHomeAttr = node.Card.Action.Kind == ActionKind.Travel
            && _project.HomePageId is not null
            && node.Card.Action.TargetPageId == _project.HomePageId
                ? " data-travel-home=\"true\""
                : "";

        sb.AppendLine($"{pad}<!-- {SafeComment(node.Card.HeadingText)} -->");
        sb.AppendLine($"{pad}<div class=\"node\"{persistentAttr}{modalAttr}{travelHomeAttr}{BuildPuzzleAttr(node)} style=\"left: {Px(left)}px; top: {Px(top)}px;\">");
        sb.AppendLine($"{pad}  <img class=\"nodeImage\" src=\"{iconSrc}\">");

        sb.AppendLine();
        sb.AppendLine($"{pad}  <!-- Info -->");

        RenderCard(sb, sourcePage, node, indent + 2);

        sb.AppendLine($"{pad}</div>");
        sb.AppendLine($"{pad}<!-------------------->");
        sb.AppendLine();
    }

    private void RenderCard(StringBuilder sb, Page sourcePage, Node node, int indent)
    {
        var pad = new string(' ', indent);
        var card = node.Card;
        var modalAttr = card.Size == CardSize.Modal ? " data-modal=\"true\"" : "";
        var cardClass = OpensTrackFocus(card) ? "floatInfo trackCard" : "floatInfo";

        sb.AppendLine($"{pad}<div class=\"{cardClass}\"{modalAttr} style=\"{BuildCardStyle(card)}\">");

        if (!string.IsNullOrEmpty(card.CoverImagePath))
            sb.AppendLine($"{pad}  <img class=\"songCover\" src=\"{EscapeAttr(ResolveAsset(card.CoverImagePath))}\">");

        if (card.Audio is not null)
        {
            // Modal cards stay outside the location-zoned proximity system entirely (see
            // Card.cs's own doc on CardSize.Modal) - Z closes them (main.js's modalQueue), never
            // toggles their audio, so they keep a manual <audio controls> player.
            //
            // Every other card's music is driven by where the ship is (see main.js's updateLocationAudio) -
            // no `controls` (a manually-scrubbed/paused element would just fight the per-frame
            // volume/play control every frame) and no key hint of its own (Z opens Track Focus, not
            // anything to do with this element - see RenderFocusAction).
            // preload="none" so the browser doesn't eagerly fetch every location's (often
            // externally-hosted) track on page load - main.js flips it to "auto" once the ship
            // is close enough to actually need it buffered.
            if (card.Size != CardSize.Modal)
                sb.AppendLine($"{pad}  <audio class=\"songPlayer\" preload=\"none\" src=\"{EscapeAttr(card.Audio.Url)}\"></audio>");
            else
                sb.AppendLine($"{pad}  <audio class=\"songPlayer\" controls src=\"{EscapeAttr(card.Audio.Url)}\"></audio>");
        }

        sb.AppendLine($"{pad}  <!-- Text -->");

        var headingOffset = card.HeadingOffset ?? (card.Size == CardSize.Hub ? new Offset { Top = 10, Left = 150 } : null);
        var headingStyle = headingOffset is not null
            ? $" style=\"left: {Px(headingOffset.Left)}px; top: {Px(headingOffset.Top)}px;\""
            : "";
        sb.AppendLine($"{pad}  <h3{headingStyle}>{EscapeText(card.HeadingText)}</h3>");
        sb.AppendLine();

        var poetryOffset = card.PoetryOffset ?? (card.Size == CardSize.Hub ? new Offset { Top = 20, Left = 175 } : null);
        var poetryStyle = poetryOffset is not null
            ? $" style=\"left: {Px(poetryOffset.Left)}px; top: {Px(poetryOffset.Top)}px;\""
            : "";
        sb.AppendLine($"{pad}  <div class=\"poetry-text\"{poetryStyle}>");

        foreach (var line in card.PoetryLines)
            sb.AppendLine($"{pad}    <div class=\"poetry-line\">{RenderPoetryLine(line)}</div>");

        RenderFocusAction(sb, card, pad);
        RenderAction(sb, sourcePage, card, pad);

        // A modal's defining interaction - Z/gamepad A closes it (see main.js's modalQueue) -
        // is independent of whatever Card.Action is separately configured (typically None, same
        // as the original tutorial card), so it's rendered here rather than as another
        // RenderAction case. The click handler lives in main.js, bound to this class.
        if (card.Size == CardSize.Modal)
        {
            sb.AppendLine();
            sb.AppendLine($"{pad}    <!-- Close -->");
            sb.AppendLine($"{pad}    <div class=\"poetry-close\">");
            sb.AppendLine($"{pad}      <span class=\"modal-close-action\">[ Close ]</span><img class=\"keyHint\" src=\"img/ui/key_z.gif\">");
            sb.AppendLine($"{pad}    </div>");
        }

        sb.AppendLine($"{pad}  </div>");

        foreach (var panel in card.ExtraPanels)
            RenderStaticPanel(sb, panel, indent);

        foreach (var child in node.Children)
            RenderNode(sb, sourcePage, child, isNested: true, indent);

        // Closes the .floatInfo opened above. Deliberately emitted after any nested children
        // (rather than right after the poetry-text div) so a childless node's card - the common
        // case - is a properly self-closed, well-formed element: leaving it open here would let
        // the *next sibling* .node get parsed as this card's descendant instead, compounding
        // every subsequent top-level node's effective position. For a node that does have
        // children this still nests them inside the still-open .floatInfo in the rendered DOM
        // (matching the original hand-authored "parent-card-relative" nesting convention) -
        // it's just expressed as an explicit, well-formed close instead of relying on the
        // browser's unclosed-tag recovery to get there.
        sb.AppendLine($"{pad}</div>");
    }

    // Mirrors main.js's onInteract, which is what Z/gamepad A will actually do on this card: a track
    // opens Track Focus, unless it's a travel location, where Z travels instead.
    private static readonly JsonSerializerOptions PuzzleJsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    // A track's puzzle, for main.js to play on its Sokoban board. Only where it could be played: the
    // board needs Track Focus and the art. The id is another exception to Node.Id staying out of the
    // HTML, for the same reason as a modal's: main.js remembers across visits which were solved.
    private static string BuildPuzzleAttr(Node node)
    {
        var puzzle = node.Puzzle;
        if (puzzle is null || !OpensTrackFocus(node.Card) || string.IsNullOrEmpty(node.Card.CoverImagePath))
            return "";

        var json = JsonSerializer.Serialize(new { id = node.Id, objects = puzzle.Objects, palette = puzzle.Palette, textures = puzzle.Textures }, PuzzleJsonOptions);
        return $" data-puzzle=\"{EscapeAttr(json)}\"";
    }

    private static bool OpensTrackFocus(Card card) =>
        card.Audio is not null && card.Action.Kind != ActionKind.Travel && card.Size != CardSize.Modal;

    // The click handler lives in main.js, bound to this class.
    private static void RenderFocusAction(StringBuilder sb, Card card, string pad)
    {
        if (!OpensTrackFocus(card))
            return;

        sb.AppendLine();
        sb.AppendLine($"{pad}    <!-- Focus -->");
        sb.AppendLine($"{pad}    <div class=\"poetry-focus\">");
        sb.AppendLine($"{pad}      <img class=\"keyHint\" src=\"img/ui/key_z.gif\"><span class=\"focus-action\">[ Enter ]</span>");
        sb.AppendLine($"{pad}    </div>");
    }

    private void RenderAction(StringBuilder sb, Page sourcePage, Card card, string pad)
    {
        switch (card.Action.Kind)
        {
            case ActionKind.Download:
                sb.AppendLine();
                sb.AppendLine($"{pad}    <!-- Download -->");
                sb.AppendLine($"{pad}    <div class=\"poetry-download\">");
                sb.AppendLine($"{pad}      <a href=\"{EscapeAttr(card.Action.Url ?? "")}\" target=\"_blank\" rel=\"noreferrer noopener\">[ Download ]</a>");
                sb.AppendLine($"{pad}    </div>");
                break;

            case ActionKind.Travel:
                var targetFileName = card.Action.TargetPageId is not null
                    && _pageFileNamesById.TryGetValue(card.Action.TargetPageId, out var fileName)
                        ? fileName
                        : throw new InvalidOperationException(
                            $"Travel action targets unknown page id '{card.Action.TargetPageId}'.");

                sb.AppendLine();
                sb.AppendLine($"{pad}    <!-- Travel -->");
                sb.AppendLine($"{pad}    <div class=\"poetry-travel\">");
                sb.Append($"{pad}      ");
                // Z always reaches Travel now - location audio follows the ship's square, not
                // Z-toggled anymore (see onInteract), so it never competes for this hint.
                sb.Append($"<img class=\"keyHint\" src=\"img/ui/key_z.gif\">");
                sb.Append($"<a href=\"./{EscapeAttr(targetFileName)}{BuildTravelQuery(sourcePage, card.Action)}\">[ TRAVEL ]</a>");
                sb.AppendLine();
                sb.AppendLine($"{pad}    </div>");
                break;

            case ActionKind.None:
            default:
                break;
        }
    }

    // TravelSpawnX/Y are an explicit override - when neither is set, the default depends on
    // direction:
    //
    // - Leaving the hub (sourcePage is WeaveProject.HomePageId) for a planet: land on the planet's
    //   GridLayout.EntrySquare, where its node back to the hub also sits, so a planet is always
    //   entered and left from the same place.
    // - Any other direction (most commonly a planet's own "return to the hub" link): land exactly on
    //   whichever node on the target page has its own Travel action pointing back at sourcePage. This
    //   is what makes "travel to a planet, then travel back to the hub" put the ship back on the icon
    //   it just left, making it obvious where it came from, without needing every reciprocal pair of
    //   travel links hand-tuned to agree - a real, previously-stale problem (a hub icon moving after
    //   its planet's own return link had its spawn coordinates typed in by hand once) that a computed
    //   default can't get wrong the way a copy-pasted constant can.
    private string BuildTravelQuery(Page sourcePage, CardAction action)
    {
        var parts = new List<string>();

        var x = action.TravelSpawnX;
        var y = action.TravelSpawnY;

        if (x is null || y is null)
        {
            var targetPage = action.TargetPageId is not null
                ? _project.Pages.FirstOrDefault(p => p.Id == action.TargetPageId)
                : null;

            if (targetPage is not null && _project.HomePageId is not null && sourcePage.Id == _project.HomePageId)
            {
                var grid = GridLayout.For(targetPage, _project);
                x = grid.ColumnCenter(GridLayout.EntrySquare.Col);
                y = grid.RowCenter(GridLayout.EntrySquare.Row);
            }
            else
            {
                var reciprocal = FindReciprocalSpawnPoint(sourcePage, targetPage);
                if (reciprocal is not null)
                {
                    x = reciprocal.Value.X;
                    y = reciprocal.Value.Y;
                }
            }
        }

        if (x is double xx && y is double yy)
        {
            parts.Add($"x={Px(xx)}");
            parts.Add($"y={Px(yy)}");
        }

        if (action.TravelSkipTutorial)
            parts.Add("tutorial=off");

        return parts.Count == 0 ? "" : "?" + string.Join("&amp;", parts);
    }

    // The one node on targetPage whose own Travel action points back at sourcePage - null if
    // there's no such node, or (deliberately, to avoid guessing wrong) more than one.
    private static (double X, double Y)? FindReciprocalSpawnPoint(Page sourcePage, Page? targetPage)
    {
        if (targetPage is null) return null;

        var matches = new List<Node>();

        void Walk(IEnumerable<Node> nodes)
        {
            foreach (var n in nodes)
            {
                if (n.Card.Action.Kind == ActionKind.Travel && n.Card.Action.TargetPageId == sourcePage.Id)
                    matches.Add(n);

                Walk(n.Children);
            }
        }

        Walk(targetPage.Nodes);

        return matches.Count == 1 ? (matches[0].X, matches[0].Y) : null;
    }

    private void RenderStaticPanel(StringBuilder sb, StaticTextBlock panel, int indent)
    {
        var pad = new string(' ', indent);

        sb.AppendLine($"{pad}<!-- {SafeComment(panel.HeadingText)} -->");
        sb.AppendLine($"{pad}<div class=\"floatInfo\" style=\"position: absolute; left: {Px(panel.Offset.Left)}px; top: {Px(panel.Offset.Top)}px;\">");
        sb.AppendLine($"{pad}  <h3>{EscapeText(panel.HeadingText)}</h3>");
        sb.AppendLine($"{pad}  <div class=\"poetry-text\">");

        foreach (var line in panel.Lines)
            sb.AppendLine($"{pad}    <div class=\"poetry-line\">{RenderPoetryLine(line)}</div>");

        sb.AppendLine($"{pad}  </div>");
        sb.AppendLine($"{pad}</div>");
    }

    // Modal is handled as a complete, separate style string (rather than a case in the switch
    // below) because it needs top/left to mean "50%, centered via transform" - the switch's
    // common tail always appends Card.Offset-derived top/left *after* the switch, which would
    // silently win (later declarations override earlier ones in the same inline style attribute)
    // and re-break centering if Modal tried to set top/left inside the switch instead.
    private static string BuildCardStyle(Card card)
    {
        if (card.Size == CardSize.Modal)
        {
            // height:auto (sizing to content) was tried here and reverted: it doesn't work for
            // this card's real shape. An ExtraPanel (e.g. the tutorial's own "Updates:" column -
            // see RenderStaticPanel) is deliberately position:absolute so it can sit in its own
            // spot beside the main poetry-text column - but per the CSS spec, an absolutely
            // positioned descendant never contributes to an auto-height ancestor's own size. The
            // result was a box that shrank to fit only the in-flow column while the absolutely
            // positioned one hung out past it, unclipped - worse than what this replaced.
            // 560px is generous enough for a typical tutorial+updates card without needing
            // CustomHeightPx set by hand; overflow-y:auto is the safety net for anything longer
            // (or for whatever explicit CustomHeightPx someone sets instead).
            var modalParts = new List<string>
            {
                $"width: {card.CustomWidthPx ?? 520}px",
                $"height: {card.CustomHeightPx ?? 560}px",
                "overflow-y: auto",
                "position: fixed",
                "top: 50%",
                "left: 50%",
                "transform: translate(-50%, -50%)",
                "display:none",
            };
            return string.Join("; ", modalParts);
        }

        var parts = new List<string>();

        switch (card.Size)
        {
            case CardSize.Hub:
                parts.Add("width: 512px");
                // 460px normally; 54px shorter when this card actually has audio - see
                // .floatInfo's own comment in main.css on where that number comes from. A
                // Hub-sized card without audio (the common case - a planet/sector travel hub)
                // never rendered the old <audio controls> row its height used to account for,
                // so it keeps the full size instead of shrinking into space it never had.
                parts.Add(card.Audio is not null ? "height: 406px" : "height: 460px");
                parts.Add("position: absolute");
                break;

            case CardSize.Custom:
                if (card.CustomWidthPx is int w) parts.Add($"width: {w}px");
                if (card.CustomHeightPx is int h) parts.Add($"height: {h}px");
                parts.Add("position: absolute");
                break;

            case CardSize.Standard:
            default:
                // .floatInfo's own CSS default (505px) already covers the common no-audio case
                // (informational/travel-only cards) - only override it down to the shorter,
                // audio-reclaimed height (see main.css) when this specific card actually has one.
                // A track's card has no poetry showing to leave room for (see .trackCard in
                // main.css), so it just fits whatever's left.
                if (OpensTrackFocus(card)) parts.Add("height: auto");
                else if (card.Audio is not null) parts.Add("height: 451px");
                parts.Add("position: relative");
                break;
        }

        parts.Add($"top: {Px(card.Offset.Top)}px");
        parts.Add($"left: {Px(card.Offset.Left)}px");
        parts.Add("display:none");

        return string.Join("; ", parts);
    }

    // **bold** -> <b>bold</b>. Everything else - including intentional literal &nbsp; and
    // <a href>...</a> links - passes through verbatim; see Card.PoetryLines' safe-markup note.
    private static string RenderPoetryLine(string line) => BoldPattern.Replace(line, "<b>$1</b>");

    private static string Px(double value) =>
        value == Math.Floor(value)
            ? ((long)value).ToString(CultureInfo.InvariantCulture)
            : value.ToString("0.###", CultureInfo.InvariantCulture);

    private static string EscapeText(string value) => WebUtility.HtmlEncode(value);

    private static string EscapeAttr(string value) => WebUtility.HtmlEncode(value);

    // HTML comments aren't a security boundary, but a stray "-->" in a heading would break
    // the surrounding markup, so it's neutralized rather than escaped.
    private static string SafeComment(string value) => value.Replace("-->", "- >");
}
