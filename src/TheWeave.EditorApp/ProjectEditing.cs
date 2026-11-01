using System.Text.RegularExpressions;
using TheWeave.Core.Model;
using TheWeave.Core.Model.Effects;

namespace TheWeave.EditorApp;

/// <summary>
/// In-memory mutations on a WeaveProject that the tree/inspector UI needs: find/add/remove a
/// page or node (including nested ones), and apply an Inspector form submission to a node.
/// Kept separate from Program.cs's message routing so the actual editing logic reads clearly.
/// </summary>
internal static class ProjectEditing
{
    public static Page? FindPage(WeaveProject project, string pageId) =>
        project.Pages.FirstOrDefault(p => p.Id == pageId);

    public static Node? FindNode(IEnumerable<Node> nodes, string nodeId)
    {
        foreach (var node in nodes)
        {
            if (node.Id == nodeId)
                return node;

            var found = FindNode(node.Children, nodeId);
            if (found is not null)
                return found;
        }

        return null;
    }

    /// <summary>
    /// Same slugging rule new node ids are generated with (lowercase, non-alphanumeric runs
    /// collapsed to a single "-", trimmed), but without the auto-dedup suffix a generator
    /// applies - a manual rename to an id that's already taken should be rejected and
    /// reported, not silently redirected to "-2".
    /// </summary>
    public static string NormalizeId(string raw) =>
        NonAlphaNumeric.Replace(raw.Trim().ToLowerInvariant(), "-").Trim('-');

    public static bool IsNodeIdInUse(WeaveProject project, string id)
    {
        foreach (var page in project.Pages)
            if (FindNode(page.Nodes, id) is not null)
                return true;

        return false;
    }

    /// <summary>How many nodes (anywhere in the project) reference this exact cover image path.</summary>
    public static int CountCoverImageReferences(WeaveProject project, string coverImagePath)
    {
        var count = 0;

        void Walk(IEnumerable<Node> nodes)
        {
            foreach (var node in nodes)
            {
                if (node.Card.CoverImagePath == coverImagePath)
                    count++;

                Walk(node.Children);
            }
        }

        foreach (var page in project.Pages)
            Walk(page.Nodes);

        return count;
    }

    public static bool RemoveNode(List<Node> nodes, string nodeId)
    {
        var index = nodes.FindIndex(n => n.Id == nodeId);
        if (index >= 0)
        {
            nodes.RemoveAt(index);
            return true;
        }

        foreach (var node in nodes)
        {
            if (RemoveNode(node.Children, nodeId))
                return true;
        }

        return false;
    }

    /// <param name="x">Where on the map to add a top-level location: it goes in that square, and
    /// that square has to be free. Null on either axis means anywhere - the first free square.</param>
    public static Node AddNode(WeaveProject project, Page page, string? parentNodeId, double? x = null, double? y = null)
    {
        var node = new Node
        {
            Id = GenerateNodeId(project, "new location"),
            Card = new Card { HeadingText = "New Location" },
        };

        if (parentNodeId is not null)
        {
            var parent = FindNode(page.Nodes, parentNodeId)
                ?? throw new InvalidOperationException($"Parent node '{parentNodeId}' not found.");
            parent.Children.Add(node);
        }
        else
        {
            (node.X, node.Y) = x is double px && y is double py
                ? ResolveSquare(project, page, null, px, py)
                : FirstFreeSquare(project, page);
            page.Nodes.Add(node);
        }

        return node;
    }

    /// <summary>
    /// Where a location is allowed to go, given where it was asked to: the center of that position's
    /// square. Throws if another location is already there, which is the only way a top-level node's
    /// position ever fails. A nested node or a modal card isn't on the map, so anything goes.
    /// </summary>
    public static (double X, double Y) ResolveNodePosition(WeaveProject project, Page page, Node node, double x, double y) =>
        IsOnMap(page, node) ? ResolveSquare(project, page, node, x, y) : (x, y);

    private static bool IsOnMap(Page page, Node node) =>
        node.Card.Size != CardSize.Modal && page.Nodes.Contains(node);

    // x/y are a top-left icon corner, same as Node.X/Y.
    private static (double X, double Y) ResolveSquare(WeaveProject project, Page page, Node? moving, double x, double y)
    {
        var grid = GridLayout.For(page, project);
        var cell = grid.CellAt(x + GridLayout.NodeIconSizePx / 2, y + GridLayout.NodeIconSizePx / 2);

        var occupant = page.Nodes.FirstOrDefault(n => n != moving && n.Card.Size != CardSize.Modal && grid.CellOf(n) == cell);
        if (occupant is not null)
            throw new InvalidOperationException($"Square {grid.LabelOf(cell)} already has '{occupant.Card.HeadingText}' on it.");

        return grid.NodePositionFor(cell);
    }

    private static (double X, double Y) FirstFreeSquare(WeaveProject project, Page page)
    {
        var grid = GridLayout.For(page, project);
        var taken = page.Nodes.Where(n => n.Card.Size != CardSize.Modal).Select(grid.CellOf).ToHashSet();
        var cell = grid.NearestFreeCell(new GridCell(0, 0), taken)
            ?? throw new InvalidOperationException("Every square on this map already has a location on it.");
        return grid.NodePositionFor(cell);
    }

    public static Page AddPage(WeaveProject project, string? titleSeed, string? outputFileName, string? backgroundImagePath)
    {
        var title = string.IsNullOrWhiteSpace(titleSeed) ? "New Page" : titleSeed.Trim();
        var id = GeneratePageId(project, title);

        var page = new Page
        {
            Id = id,
            Title = title,
            OutputFileName = string.IsNullOrWhiteSpace(outputFileName) ? $"{id}.html" : outputFileName.Trim(),
            Background = new ImageRef { ImagePath = string.IsNullOrWhiteSpace(backgroundImagePath) ? "img/placeholder.png" : backgroundImagePath.Trim() },
        };

        project.Pages.Add(page);
        return page;
    }

    public static void ApplyNodeEdit(WeaveProject project, Page page, Node node, NodeEditRequest edit)
    {
        // Resolved before anything else changes, so a rejected square leaves the whole node untouched.
        (node.X, node.Y) = ResolveNodePosition(project, page, node, edit.X, edit.Y);
        node.Persistent = edit.Persistent;
        node.IconStyle = Enum.TryParse<IconStyle>(edit.IconStyle, out var iconStyle) ? iconStyle : IconStyle.Default;

        var card = node.Card;
        card.Size = Enum.TryParse<CardSize>(edit.CardSize, out var size) ? size : CardSize.Standard;
        card.CustomWidthPx = edit.CustomWidthPx;
        card.CustomHeightPx = edit.CustomHeightPx;
        card.HeadingText = edit.HeadingText;
        card.CoverImagePath = string.IsNullOrWhiteSpace(edit.CoverImagePath) ? null : edit.CoverImagePath.Trim();
        card.Audio = string.IsNullOrWhiteSpace(edit.AudioUrl) ? null : new AudioRef { Url = edit.AudioUrl.Trim() };
        card.PoetryLines = edit.PoetryLines ?? new List<string>();

        card.Action = new CardAction
        {
            Kind = Enum.TryParse<ActionKind>(edit.ActionKind, out var kind) ? kind : ActionKind.None,
            Url = string.IsNullOrWhiteSpace(edit.ActionUrl) ? null : edit.ActionUrl.Trim(),
            TargetPageId = string.IsNullOrWhiteSpace(edit.TargetPageId) ? null : edit.TargetPageId,
            TravelSpawnX = edit.TravelSpawnX,
            TravelSpawnY = edit.TravelSpawnY,
            TravelSkipTutorial = edit.TravelSkipTutorial,
        };
    }

    public static void ApplyPageEdit(WeaveProject project, Page page, PageEditRequest edit)
    {
        if (!string.IsNullOrWhiteSpace(edit.Title))
            page.Title = edit.Title.Trim();

        if (!string.IsNullOrWhiteSpace(edit.OutputFileName))
            page.OutputFileName = edit.OutputFileName.Trim();

        if (!string.IsNullOrWhiteSpace(edit.BackgroundImagePath))
            page.Background = new ImageRef { ImagePath = edit.BackgroundImagePath.Trim() };


        if (edit.GlobeEffect is bool globeEffect)
            page.GlobeEffect = globeEffect;

        if (edit.IsHome is true)
            project.HomePageId = page.Id;
        else if (edit.IsHome is false && project.HomePageId == page.Id)
            project.HomePageId = null;

        page.DefaultSpawnX = edit.DefaultSpawnX;
        page.DefaultSpawnY = edit.DefaultSpawnY;
    }

    public static void ApplyProjectEdit(WeaveProject project, ProjectEditRequest edit)
    {
        project.BackgroundMusicPath = string.IsNullOrWhiteSpace(edit.BackgroundMusicPath)
            ? null
            : edit.BackgroundMusicPath.Trim();

        // Unlike BackgroundMusicPath, this never clears to null/a blank-field default - a
        // missing or non-positive value just leaves whatever the project already had (its own
        // schema default, 105, the first time this is ever called).
        if (edit.ListeningRadiusPx is double radius && radius > 0)
            project.ListeningRadiusPx = radius;
    }

    /// <summary>The one CardSize.Modal node on the project's home page, if any - see
    /// ApplyTutorialModalEdit's own doc for why this is looked up rather than referenced by id.</summary>
    public static Node? FindTutorialModalNode(WeaveProject project)
    {
        if (project.HomePageId is null) return null;
        var page = FindPage(project, project.HomePageId);
        return page?.Nodes.FirstOrDefault(n => n.Card.Size == CardSize.Modal);
    }

    /// <summary>
    /// Applies the Tutorial Modal tab's form to the project's home page's one CardSize.Modal
    /// node, creating it (Persistent, centered via its Card.Size alone - X/Y are unused by a
    /// modal card and left at a nominal spot) if this is the very first save. Its "Updates:"
    /// panel (Card.ExtraPanels[0]) is created the same way, first save an ExtraPanel exists at all.
    /// </summary>
    public static Node ApplyTutorialModalEdit(WeaveProject project, TutorialModalEditRequest edit)
    {
        if (project.HomePageId is null)
            throw new InvalidOperationException("Set a Starting Map page (see the Page inspector) before editing the Tutorial Modal.");

        var page = FindPage(project, project.HomePageId)
            ?? throw new InvalidOperationException($"Home page '{project.HomePageId}' not found.");

        var node = page.Nodes.FirstOrDefault(n => n.Card.Size == CardSize.Modal);
        if (node is null)
        {
            node = new Node
            {
                Id = GenerateNodeId(project, "tutorial-modal"),
                X = 50,
                Y = 50,
                Persistent = true,
                Card = new Card { Size = CardSize.Modal },
            };
            page.Nodes.Add(node);
        }

        var card = node.Card;
        card.HeadingText = edit.HeadingText;
        card.CoverImagePath = string.IsNullOrWhiteSpace(edit.CoverImagePath) ? null : edit.CoverImagePath.Trim();
        card.Audio = string.IsNullOrWhiteSpace(edit.AudioUrl) ? null : new AudioRef { Url = edit.AudioUrl.Trim() };
        card.PoetryLines = edit.PoetryLines ?? new List<string>();

        var updates = card.ExtraPanels.FirstOrDefault();
        if (updates is null)
        {
            updates = new StaticTextBlock { Offset = new Offset { Top = 0, Left = 260 } };
            card.ExtraPanels.Add(updates);
        }
        updates.HeadingText = edit.UpdatesHeadingText;
        updates.Lines = edit.UpdatesLines ?? new List<string>();

        return node;
    }

    public static PageEffect AddEffect(Page page, EffectEditRequest edit)
    {
        var effect = BuildEffect(GenerateEffectId(page, edit.Kind), edit);
        page.Effects.Add(effect);
        SyncSecondaryBackground(page);
        return effect;
    }

    public static void UpdateEffect(Page page, string effectId, EffectEditRequest edit)
    {
        var index = page.Effects.FindIndex(e => e.Id == effectId);
        if (index < 0)
            throw new InvalidOperationException($"Effect '{effectId}' not found.");

        page.Effects[index] = BuildEffect(effectId, edit);
        SyncSecondaryBackground(page);
    }

    public static bool RemoveEffect(Page page, string effectId)
    {
        var removed = page.Effects.RemoveAll(e => e.Id == effectId) > 0;
        if (removed)
            SyncSecondaryBackground(page);
        return removed;
    }

    private static PageEffect BuildEffect(string id, EffectEditRequest edit)
    {
        if (edit.Kind == "Drift")
        {
            return new DriftingSpriteEffect
            {
                Id = id,
                ImagePath = edit.ImagePath.Trim(),
                X = edit.X,
                Y = edit.Y,
                BlendMode = string.IsNullOrWhiteSpace(edit.BlendMode) ? null : edit.BlendMode.Trim(),
                DriftX = edit.HasDriftX
                    ? new DriftAxis { FromPx = edit.DriftXFromPx, ToPx = edit.DriftXToPx, DurationMs = edit.DriftXDurationMs, Direction = edit.DriftXDirection, Easing = edit.DriftXEasing }
                    : null,
                DriftY = edit.HasDriftY
                    ? new DriftAxis { FromPx = edit.DriftYFromPx, ToPx = edit.DriftYToPx, DurationMs = edit.DriftYDurationMs, Direction = edit.DriftYDirection, Easing = edit.DriftYEasing }
                    : null,
            };
        }

        return new CrossfadeLayerEffect
        {
            Id = id,
            ImagePath = edit.ImagePath.Trim(),
            OpacityFrom = edit.OpacityFrom,
            OpacityTo = edit.OpacityTo,
            DurationMs = edit.DurationMs,
            Direction = edit.Direction,
            Easing = edit.Easing,
        };
    }

    // A CrossfadeLayerEffect targets the page's SecondaryBackground (that's the actual
    // #bgmap2 element the exporter and runtime animate) - keep the two in sync rather than
    // making the Inspector edit both separately, so a page never ends up with one but not
    // the other.
    private static void SyncSecondaryBackground(Page page)
    {
        var crossfade = page.Effects.OfType<CrossfadeLayerEffect>().FirstOrDefault();
        page.SecondaryBackground = crossfade is null ? null : new ImageRef { ImagePath = crossfade.ImagePath };
    }

    private static string GenerateEffectId(Page page, string kind)
    {
        var used = new HashSet<string>(page.Effects.Select(e => e.Id));
        var baseSlug = kind == "Drift" ? "drift" : "crossfade";
        return Slugify(baseSlug, used);
    }

    private static string GenerateNodeId(WeaveProject project, string seed)
    {
        var used = new HashSet<string>();
        foreach (var page in project.Pages)
            CollectNodeIds(page.Nodes, used);

        return Slugify(seed, used);
    }

    private static void CollectNodeIds(IEnumerable<Node> nodes, HashSet<string> into)
    {
        foreach (var node in nodes)
        {
            into.Add(node.Id);
            CollectNodeIds(node.Children, into);
        }
    }

    private static string GeneratePageId(WeaveProject project, string seed)
    {
        var used = new HashSet<string>(project.Pages.Select(p => p.Id));
        return Slugify(seed, used);
    }

    private static readonly Regex NonAlphaNumeric = new(@"[^a-z0-9]+", RegexOptions.Compiled);

    private static string Slugify(string seed, HashSet<string> used)
    {
        var baseSlug = NonAlphaNumeric.Replace(seed.ToLowerInvariant(), "-").Trim('-');
        if (baseSlug.Length == 0)
            baseSlug = "item";

        if (used.Add(baseSlug))
            return baseSlug;

        var i = 2;
        while (!used.Add($"{baseSlug}-{i}"))
            i++;

        return $"{baseSlug}-{i}";
    }
}
