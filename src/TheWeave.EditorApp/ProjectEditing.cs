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
        // A0, rather than the number column to its left - that's a place to choose, not a default.
        var cell = grid.NearestFreeCell(new GridCell(1, 0), taken)
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
        // Checked before anything else changes, so a rejected square or requirement leaves the whole node untouched.
        var requirements = edit.Requirements is null ? node.Requirements : CheckRequirements(project, page, node, edit.Requirements);
        (node.X, node.Y) = ResolveNodePosition(project, page, node, edit.X, edit.Y);
        node.Requirements = requirements is { Count: > 0 } ? requirements : null;
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

    // A location's requirements, each a different top-level location, on any page, with stages to complete - see
    // PuzzleStages. Only a top-level location can have any, since a location's parts are locked in turn already.
    private static List<string> CheckRequirements(WeaveProject project, Page page, Node node, List<string> ids)
    {
        var distinct = ids.Where(id => !string.IsNullOrWhiteSpace(id)).Distinct().ToList();
        if (distinct.Count == 0)
            return distinct;
        if (!page.Nodes.Contains(node))
            throw new InvalidOperationException("Only a location on the map can have requirements, not one of its parts.");

        foreach (var id in distinct)
        {
            if (id == node.Id)
                throw new InvalidOperationException("A location can't require itself.");
            var required = project.Pages.SelectMany(p => p.Nodes).FirstOrDefault(n => n.Id == id)
                ?? throw new InvalidOperationException($"There's no location '{id}' on any map to require.");
            if (PuzzleStages.Of(required).Count == 0)
                throw new InvalidOperationException($"'{required.Card.HeadingText}' has no puzzles to complete, so it can't be a requirement.");
        }
        return distinct;
    }

    /// <summary>Points every requirement on a location that's been renamed at its new id.</summary>
    public static void RenameRequirements(WeaveProject project, string oldId, string newId)
    {
        foreach (var node in project.Pages.SelectMany(p => p.Nodes))
        {
            if (node.Requirements is null)
                continue;
            node.Requirements = node.Requirements.Select(id => id == oldId ? newId : id).Distinct().ToList();
        }
    }

    /// <summary>Takes locations that are gone out of every requirement, leaving the rest.</summary>
    public static void DropMissingRequirements(WeaveProject project)
    {
        var ids = project.Pages.SelectMany(p => p.Nodes).Select(n => n.Id).ToHashSet();
        foreach (var node in project.Pages.SelectMany(p => p.Nodes))
        {
            if (node.Requirements is null)
                continue;
            var kept = node.Requirements.Where(ids.Contains).ToList();
            node.Requirements = kept.Count > 0 ? kept : null;
        }
    }

    /// <summary>
    /// Replaces a node's puzzle, or removes it if null. A rejected puzzle leaves the node's as it was. Given the
    /// node's page, it also keeps the location's parts connected: a part whose next part has a puzzle can only
    /// gain a Finish on an edge, and only the one, and each part's Start follows the Finish of the part before.
    /// </summary>
    public static void ApplyPuzzleEdit(Node node, Puzzle? puzzle, Page? page = null)
    {
        var previous = page is null ? null : PreviousPart(page.Nodes, node);
        var next = node.Children.FirstOrDefault();

        if (puzzle is not null)
        {
            ValidatePuzzle(puzzle);
            if (next?.Puzzle is not null)
                CheckNewFinishesLeadOn(node.Puzzle, puzzle, next);
        }

        node.Puzzle = puzzle;

        if (previous is not null)
            LineUpStart(previous.Puzzle, node.Puzzle);
        if (next is not null)
            LineUpStart(node.Puzzle, next.Puzzle);
    }

    // Only a Finish the edit adds is held to this, so that a puzzle made before the rule can still be edited.
    private static void CheckNewFinishesLeadOn(Puzzle? before, Puzzle after, Node next)
    {
        var finishes = after.Objects.Where(o => o.Kind == PuzzleObjectKind.Finish).ToList();
        var added = finishes
            .Where(f => before is null || !before.Objects.Any(o => o.Kind == PuzzleObjectKind.Finish && o.Col == f.Col && o.Row == f.Row))
            .ToList();
        if (added.Count == 0)
            return;

        if (added.Any(f => PuzzleConnection.ExitDirectionOf(f.Col, f.Row) is null))
            throw new InvalidOperationException($"This part leads on to '{next.Card.HeadingText}', so its Finish has to be on an edge of the board, not a corner.");
        if (finishes.Count > 1)
            throw new InvalidOperationException($"This part leads on to '{next.Card.HeadingText}', so it can only have one Finish.");
    }

    // Moves a part's Start to where the ship comes in from the part before, unless something's in the way of it.
    private static void LineUpStart(Puzzle? before, Puzzle? after)
    {
        if (after is null || PuzzleConnection.EntranceAfter(before) is not { } entrance)
            return;
        if (PuzzleConnection.BlockingEntrance(after, entrance) is not null)
            return;

        var start = after.Objects.FirstOrDefault(o => o.Kind == PuzzleObjectKind.Start);
        if (start is null)
            after.Objects.Add(start = new PuzzleObject { Kind = PuzzleObjectKind.Start });
        (start.Col, start.Row) = entrance;
    }

    /// <summary>
    /// The part played just before this one: its parent, if it's that parent's first child. A location's parts
    /// are played in order down the tree, so a later sibling has no single part before it to connect to.
    /// </summary>
    public static Node? PreviousPart(IEnumerable<Node> nodes, Node node)
    {
        foreach (var candidate in nodes)
        {
            if (candidate.Children.FirstOrDefault() == node)
                return candidate;
            if (PreviousPart(candidate.Children, node) is { } found)
                return found;
        }
        return null;
    }

    public static void ValidatePuzzle(Puzzle puzzle)
    {
        foreach (var obj in puzzle.Objects)
        {
            if (obj.Col < 0 || obj.Col >= Puzzle.BoardSize || obj.Row < 0 || obj.Row >= Puzzle.BoardSize)
                throw new InvalidOperationException($"A {obj.Kind} at column {obj.Col}, row {obj.Row} is off the board.");

            var usesLetter = obj.Kind is PuzzleObjectKind.Gate or PuzzleObjectKind.Switch or PuzzleObjectKind.Teleporter;
            if (usesLetter && (obj.Letter is not { Length: 1 } || obj.Letter[0] is < 'A' or > 'Z'))
                throw new InvalidOperationException($"A {obj.Kind} needs a letter from A to Z.");
            if (!usesLetter)
                obj.Letter = null;

            var pointsSomewhere = IsFloorTile(obj) || obj.Kind is PuzzleObjectKind.JumpTile or PuzzleObjectKind.Archeton;
            if (pointsSomewhere && obj.Direction is null)
                throw new InvalidOperationException($"A {obj.Kind} needs a direction.");
            if (!pointsSomewhere)
                obj.Direction = null;

            if (obj.Kind == PuzzleObjectKind.PushBlock && obj.Symbol is null)
                throw new InvalidOperationException("A Push Block needs a symbol.");
            if (obj.Kind != PuzzleObjectKind.PushBlock)
                obj.Symbol = null;

            if (obj.Kind == PuzzleObjectKind.Archeton && string.IsNullOrWhiteSpace(obj.Archeton))
                throw new InvalidOperationException("An Archeton needs to say which one it is.");
            if (obj.Kind != PuzzleObjectKind.Archeton)
                obj.Archeton = null;

            if (obj.Kind is PuzzleObjectKind.Finish or PuzzleObjectKind.Start)
                obj.Invisible = false;

            if (obj.Kind != PuzzleObjectKind.Gate)
                obj.Open = false;

            // An Archeton is drawn with its definition's drawing, so it never has one of its own.
            if (!PuzzleDrawings.DrawnKinds.Contains(obj.Kind) || string.IsNullOrEmpty(obj.Variant) || obj.Kind == PuzzleObjectKind.Archeton)
                obj.Variant = null;
        }

        var crowded = puzzle.Objects
            .GroupBy(o => (o.Col, o.Row, IsFloor: IsFloorTile(o)))
            .FirstOrDefault(g => g.Count() > 1);
        if (crowded is not null)
            throw new InvalidOperationException($"Column {crowded.Key.Col}, row {crowded.Key.Row} holds more than one {(crowded.Key.IsFloor ? "floor tile" : "object")}.");

        if (puzzle.Objects.Count(o => o.Kind == PuzzleObjectKind.Start) > 1)
            throw new InvalidOperationException("A puzzle can only have one Start.");

        foreach (var (role, texture) in puzzle.Textures)
        {
            if (texture.Ramp.Count == 0 || (texture.Grain ?? texture.Pixels)?.Length != PuzzleDrawings.TilePixels)
                throw new InvalidOperationException($"The {role} texture isn't complete.");
        }
    }

    private static bool IsFloorTile(PuzzleObject obj) =>
        obj.Kind is PuzzleObjectKind.Stream or PuzzleObjectKind.RotatorTile or PuzzleObjectKind.Pipe;

    /// <summary>
    /// Replaces the project's whole library of drawings, and its sets of them unless sets is null. Anything drawn
    /// with a drawing that's gone goes back to its kind's Standard drawing, and it leaves every set it was in.
    /// </summary>
    public static void ApplyPuzzleDrawingsEdit(WeaveProject project, List<PuzzleDrawing> drawings, List<PuzzleDrawingSet>? sets = null)
    {
        ValidatePuzzleDrawings(drawings);
        sets ??= project.PuzzleDrawingSets?.Select(s => new PuzzleDrawingSet { Id = s.Id, Kind = s.Kind, Name = s.Name, Drawings = [.. s.Drawings] }).ToList() ?? [];
        ValidatePuzzleDrawingSets(sets);

        project.PuzzleDrawings = drawings.Count > 0 ? drawings : null;

        bool Exists(PuzzleObjectKind kind, string id) => id == kind.ToString() || drawings.Any(d => d.Id == id && d.Kind == kind);
        foreach (var set in sets)
            set.Drawings = set.Drawings.Where(id => Exists(set.Kind, id)).Distinct().ToList();
        project.PuzzleDrawingSets = sets.Count > 0 ? sets : null;

        foreach (var obj in PuzzlesIn(project.Pages.SelectMany(p => p.Nodes)).SelectMany(p => p.Objects))
        {
            if (obj.Variant is not null && !drawings.Any(d => d.Id == obj.Variant && d.Kind == obj.Kind))
                obj.Variant = null;
        }

        // An Archeton whose drawing's gone goes back to the Standard one.
        foreach (var definition in project.Archetons ?? [])
        {
            if (definition.Drawing is not null && !drawings.Any(d => d.Id == definition.Drawing && d.Kind == PuzzleObjectKind.Archeton))
                definition.Drawing = null;
        }
    }

    /// <summary>Adds Sentribeam to a project that's never had Archetons, so there's always one to start from.</summary>
    public static void SeedArchetons(WeaveProject project)
    {
        project.Archetons ??= [ArchetonDefinitions.Sentribeam()];
    }

    /// <summary>
    /// Replaces the project's whole library of Archetons. Each needs an id of its own, a name, and parts with sensible
    /// settings, drawn with an Archeton drawing that exists. One still placed on a board can't be removed.
    /// </summary>
    public static void ApplyArchetonsEdit(WeaveProject project, List<ArchetonDefinition> archetons)
    {
        ValidateArchetons(archetons, project.PuzzleDrawings);

        var kept = archetons.Select(a => a.Id).ToHashSet();
        foreach (var page in project.Pages)
        {
            foreach (var node in NodesIn(page.Nodes))
            {
                var used = node.Puzzle?.Objects.FirstOrDefault(o => o.Kind == PuzzleObjectKind.Archeton && o.Archeton is not null && !kept.Contains(o.Archeton));
                if (used is not null)
                    throw new InvalidOperationException($"'{project.Archetons?.FirstOrDefault(a => a.Id == used.Archeton)?.Name ?? used.Archeton}' is still on the board of '{node.Card.HeadingText}', so it can't be deleted.");
            }
        }

        project.Archetons = archetons;
    }

    /// <summary>Adds the Archetons a puzzle file brought with it, leaving any already there alone.</summary>
    public static void AddArchetons(WeaveProject project, List<ArchetonDefinition> archetons)
    {
        var library = project.Archetons ?? [];
        var combined = library.Concat(archetons.Where(a => library.All(existing => existing.Id != a.Id))).ToList();
        ValidateArchetons(combined, project.PuzzleDrawings);
        project.Archetons = combined;
    }

    public static void ValidateArchetons(List<ArchetonDefinition> archetons, List<PuzzleDrawing>? drawings)
    {
        foreach (var archeton in archetons)
        {
            if (string.IsNullOrWhiteSpace(archeton.Id))
                throw new InvalidOperationException("An Archeton needs an id.");
            archeton.Name = archeton.Name.Trim();
            if (archeton.Name.Length == 0)
                throw new InvalidOperationException("An Archeton needs a name.");
            if (archeton.Drawing is not null && !(drawings ?? []).Any(d => d.Id == archeton.Drawing && d.Kind == PuzzleObjectKind.Archeton))
                throw new InvalidOperationException($"'{archeton.Name}' is drawn with a drawing that isn't one of the Archeton drawings.");

            foreach (var part in archeton.Parts)
            {
                if (part.Kind == ArchetonPartKind.Beam)
                {
                    if (part.Range is not { } range || range < 1 || range > ArchetonDefinitions.MaxRange)
                        throw new InvalidOperationException($"'{archeton.Name}''s Beam needs a range from 1 to {ArchetonDefinitions.MaxRange}.");
                    part.Look ??= ArchetonLook.AllWays;
                    part.BlockedByBlocks ??= true;
                }
                else
                {
                    part.Range = null;
                    part.Look = null;
                    part.BlockedByBlocks = null;
                }
            }
        }

        if (archetons.GroupBy(a => a.Id).FirstOrDefault(g => g.Count() > 1) is { } repeated)
            throw new InvalidOperationException($"More than one Archeton has the id '{repeated.Key}'.");
    }

    private static IEnumerable<Node> NodesIn(IEnumerable<Node> nodes) =>
        nodes.SelectMany(n => new[] { n }.Concat(NodesIn(n.Children)));

    public static void ValidatePuzzleDrawingSets(List<PuzzleDrawingSet> sets)
    {
        foreach (var set in sets)
        {
            if (string.IsNullOrWhiteSpace(set.Id))
                throw new InvalidOperationException("A drawing set needs an id.");
            if (!PuzzleDrawings.DrawnKinds.Contains(set.Kind))
                throw new InvalidOperationException($"A {set.Kind} can't have drawing sets, since it has no drawings.");

            set.Name = set.Name.Trim();
            if (set.Name.Length == 0)
                throw new InvalidOperationException("A drawing set needs a name.");
        }

        if (sets.GroupBy(s => s.Id).FirstOrDefault(g => g.Count() > 1) is { } repeated)
            throw new InvalidOperationException($"More than one drawing set has the id '{repeated.Key}'.");
    }

    /// <summary>Adds the drawings a puzzle file brought with it (see PuzzleDrawings.Merge), leaving any already there alone.</summary>
    public static void AddPuzzleDrawings(WeaveProject project, List<PuzzleDrawing> drawings)
    {
        var library = project.PuzzleDrawings ?? [];
        var combined = library.Concat(drawings.Where(d => library.All(existing => existing.Id != d.Id))).ToList();
        ValidatePuzzleDrawings(combined);
        project.PuzzleDrawings = combined.Count > 0 ? combined : null;
    }

    private static IEnumerable<Puzzle> PuzzlesIn(IEnumerable<Node> nodes) =>
        nodes.SelectMany(n => (n.Puzzle is null ? [] : new[] { n.Puzzle }).Concat(PuzzlesIn(n.Children)));

    public static void ValidatePuzzleDrawings(List<PuzzleDrawing> drawings)
    {
        foreach (var drawing in drawings)
        {
            if (string.IsNullOrWhiteSpace(drawing.Id))
                throw new InvalidOperationException("A drawing needs an id.");
            if (!PuzzleDrawings.DrawnKinds.Contains(drawing.Kind))
                throw new InvalidOperationException($"A {drawing.Kind} can't have drawings: it's drawn in code, since it moves.");
            // A kind's name is the id of its Standard drawing, so no other kind's drawing can have it.
            if (Enum.TryParse<PuzzleObjectKind>(drawing.Id, out var kindNamed) && kindNamed != drawing.Kind)
                throw new InvalidOperationException($"'{drawing.Id}' is the id of the {kindNamed}'s Standard drawing.");

            drawing.Name = drawing.Name.Trim();
            if (drawing.Name.Length == 0)
                throw new InvalidOperationException("A drawing needs a name.");

            CheckDrawingPixels(drawing, drawing.Pixels);
            drawing.OpenPixels = OnlyFor(drawing, drawing.Kind == PuzzleObjectKind.Gate, drawing.OpenPixels);
            drawing.BendPixels = OnlyFor(drawing, drawing.Kind == PuzzleObjectKind.Stream, drawing.BendPixels);
            drawing.FlowPixels = OnlyFor(drawing, PuzzleDrawings.IsAnimated(drawing.Kind), drawing.FlowPixels);

            if (drawing.Mix.Count is 0 or > 4)
                throw new InvalidOperationException($"Drawing '{drawing.Name}' needs from 1 to 4 colours in its mix.");
            foreach (var colour in drawing.Mix)
            {
                if (!PuzzleDrawings.Roles.Contains(colour.Role))
                    throw new InvalidOperationException($"Drawing '{drawing.Name}' mixes in an unknown colour, '{colour.Role}'.");
                if (colour.Shade is < 0 or > 3)
                    throw new InvalidOperationException($"Drawing '{drawing.Name}' has a shade that isn't Darkest, Dark, Main or Light.");
                if (colour.Percent is < 0 or > 100)
                    throw new InvalidOperationException($"Drawing '{drawing.Name}' has a percentage outside 0 to 100.");
                // The outline and light colours have only the one shade.
                if (colour.Role is "outline" or "light")
                    colour.Shade = 0;
            }
            if (drawing.Mix.All(c => c.Percent == 0))
                throw new InvalidOperationException($"Drawing '{drawing.Name}' needs some of at least one colour in its mix.");
        }

        if (drawings.GroupBy(d => d.Id).FirstOrDefault(g => g.Count() > 1) is { } repeated)
            throw new InvalidOperationException($"More than one drawing has the id '{repeated.Key}'.");
    }

    // A layer a drawing's kind has, checked, or dropped if its kind has no such layer.
    private static string? OnlyFor(PuzzleDrawing drawing, bool kindHasIt, string? pixels)
    {
        if (!kindHasIt || pixels is null)
            return null;
        CheckDrawingPixels(drawing, pixels);
        return pixels;
    }

    private static void CheckDrawingPixels(PuzzleDrawing drawing, string pixels)
    {
        if (pixels.Length != PuzzleDrawings.TilePixels || pixels.Any(p => !PuzzleDrawings.Paints.Contains(p)))
            throw new InvalidOperationException($"Drawing '{drawing.Name}' isn't a complete 24x24 drawing.");
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
