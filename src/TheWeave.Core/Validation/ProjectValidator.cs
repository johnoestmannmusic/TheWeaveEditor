using TheWeave.Core.Model;
using TheWeave.Core.Model.Effects;

namespace TheWeave.Core.Validation;

/// <summary>
/// Checks a WeaveProject for structural problems (duplicate ids, dangling travel links) and,
/// when an asset base path is supplied, for referenced files that don't exist on disk.
/// </summary>
public static class ProjectValidator
{
    public static List<ValidationIssue> Validate(WeaveProject project, string? assetBasePath = null)
    {
        var issues = new List<ValidationIssue>();

        foreach (var group in project.Pages.GroupBy(p => p.Id).Where(g => g.Count() > 1))
        {
            issues.Add(new ValidationIssue
            {
                Severity = ValidationSeverity.Error,
                Message = $"Duplicate page id '{group.Key}'.",
                PageId = group.Key,
            });
        }

        var pageIds = new HashSet<string>(project.Pages.Select(p => p.Id));

        var allNodeIds = new List<(string PageId, string NodeId)>();
        foreach (var page in project.Pages)
            CollectNodeIds(page.Id, page.Nodes, allNodeIds);

        foreach (var group in allNodeIds.GroupBy(x => x.NodeId).Where(g => g.Count() > 1))
        {
            issues.Add(new ValidationIssue
            {
                Severity = ValidationSeverity.Error,
                Message = $"Duplicate node id '{group.Key}' (used on {group.Count()} nodes).",
                NodeId = group.Key,
            });
        }

        foreach (var page in project.Pages)
        {
            CheckAsset(page.Background.ImagePath, assetBasePath, "Background image", page.Id, null, issues);

            if (page.SecondaryBackground is not null)
                CheckAsset(page.SecondaryBackground.ImagePath, assetBasePath, "Secondary background image", page.Id, null, issues);

            foreach (var node in page.Nodes)
                CheckNode(page, node, null, pageIds, assetBasePath, project.PuzzleDrawings, issues);

            CheckGridPlacement(project, page, issues);

            foreach (var effect in page.Effects)
                CheckEffect(page, effect, assetBasePath, issues);
        }

        CheckRequirements(project, issues);

        foreach (var drawing in project.PuzzleDrawings ?? [])
        {
            // An open Gate drawn as nothing is fine: it's simply out of the way.
            if (drawing.Pixels.All(p => p == '.'))
            {
                issues.Add(new ValidationIssue
                {
                    Severity = ValidationSeverity.Warning,
                    Message = $"Drawing '{drawing.Name}' ({drawing.Kind}) has nothing drawn, so anything using it is invisible.",
                });
            }
        }

        return issues;
    }

    // A location's requirements (see Node.Requirements) each have to exist and have stages to complete, and can't lead
    // round in a loop back to it, which would leave it locked for good.
    private static void CheckRequirements(WeaveProject project, List<ValidationIssue> issues)
    {
        var topLevel = project.Pages.SelectMany(p => p.Nodes.Select(n => (Page: p, Node: n))).ToList();
        var byId = new Dictionary<string, Node>();
        foreach (var (_, node) in topLevel)
            byId.TryAdd(node.Id, node);

        foreach (var (page, node) in topLevel)
        {
            void Warn(string problem) => issues.Add(new ValidationIssue
            {
                Severity = ValidationSeverity.Warning,
                Message = $"Location '{node.Id}' {problem}",
                PageId = page.Id,
                NodeId = node.Id,
            });

            foreach (var id in node.Requirements ?? [])
            {
                if (!byId.TryGetValue(id, out var required))
                    Warn($"requires '{id}', which isn't a location on any map, so it's ignored.");
                else if (PuzzleStages.Of(required).Count == 0)
                    Warn($"requires '{id}', which has no puzzles to complete, so it's ignored.");
            }

            if (RequiresItself(node, byId))
                Warn("requires itself, by way of its requirements, so it can never be unlocked.");
        }
    }

    // Whether following a location's requirements, and theirs, ever leads back to it.
    private static bool RequiresItself(Node node, Dictionary<string, Node> byId)
    {
        var seen = new HashSet<string>();
        var queue = new Queue<string>(node.Requirements ?? []);
        while (queue.Count > 0)
        {
            var id = queue.Dequeue();
            if (id == node.Id)
                return true;
            if (!seen.Add(id) || !byId.TryGetValue(id, out var next))
                continue;
            foreach (var further in next.Requirements ?? [])
                queue.Enqueue(further);
        }
        return false;
    }

    private static void CollectNodeIds(string pageId, IEnumerable<Node> nodes, List<(string, string)> into)
    {
        foreach (var node in nodes)
        {
            into.Add((pageId, node.Id));
            CollectNodeIds(pageId, node.Children, into);
        }
    }

    // previous is the part played just before this one, if any - see CheckPuzzle.
    private static void CheckNode(Page page, Node node, Node? previous, HashSet<string> pageIds, string? assetBasePath, List<PuzzleDrawing>? drawings, List<ValidationIssue> issues)
    {
        if (node.Card.Action.Kind == ActionKind.Travel)
        {
            var target = node.Card.Action.TargetPageId;
            if (string.IsNullOrEmpty(target) || !pageIds.Contains(target))
            {
                issues.Add(new ValidationIssue
                {
                    Severity = ValidationSeverity.Error,
                    Message = $"Node '{node.Id}' travels to missing page '{target}'.",
                    PageId = page.Id,
                    NodeId = node.Id,
                });
            }
        }

        if (!string.IsNullOrEmpty(node.Card.CoverImagePath))
            CheckAsset(node.Card.CoverImagePath, assetBasePath, "Cover image", page.Id, node.Id, issues);

        if (node.Puzzle is not null)
            CheckPuzzle(page, node, previous, drawings, issues);

        for (var i = 0; i < node.Children.Count; i++)
            CheckNode(page, node.Children[i], i == 0 ? node : null, pageIds, assetBasePath, drawings, issues);
    }

    private static void CheckPuzzle(Page page, Node node, Node? previous, List<PuzzleDrawing>? drawings, List<ValidationIssue> issues)
    {
        var puzzle = node.Puzzle!;

        void Warn(string problem) => issues.Add(new ValidationIssue
        {
            Severity = ValidationSeverity.Warning,
            Message = $"Puzzle on '{node.Id}': {problem}",
            PageId = page.Id,
            NodeId = node.Id,
        });

        List<string> LettersOf(PuzzleObjectKind kind) =>
            puzzle.Objects.Where(o => o.Kind == kind).Select(o => o.Letter ?? "").Distinct().OrderBy(l => l).ToList();

        var card = node.Card;
        if (string.IsNullOrEmpty(card.CoverImagePath) || card.Audio is null || card.Action.Kind == ActionKind.Travel || card.Size == CardSize.Modal)
            Warn("this location has no Track Focus screen with album art, so it can't be played.");
        else if (puzzle.PaletteSource != card.CoverImagePath)
            Warn("its colours came from different album art. Open the Puzzle Editor to update them.");
        else if (puzzle.Textures.Count == 0)
            Warn("it was made before objects had textures. Open the Puzzle Editor to add them.");

        if (puzzle.Objects.All(o => o.Kind != PuzzleObjectKind.Finish))
            Warn("it has no Finish, so it can't be solved. It won't lock the next part until it has one.");

        var gates = LettersOf(PuzzleObjectKind.Gate);
        var switches = LettersOf(PuzzleObjectKind.Switch);
        // A Gate placed open is simply always open without a Switch, which is a fine thing to want.
        var closedGates = puzzle.Objects.Where(o => o.Kind == PuzzleObjectKind.Gate && !o.Open).Select(o => o.Letter ?? "").Distinct().OrderBy(l => l);
        foreach (var letter in closedGates.Except(switches))
            Warn($"Gate {letter} has no Switch {letter}, so it can never open.");
        foreach (var letter in switches.Except(gates))
            Warn($"Switch {letter} has no Gate {letter}, so it does nothing.");

        foreach (var group in puzzle.Objects.Where(o => o.Kind == PuzzleObjectKind.Teleporter).GroupBy(o => o.Letter ?? "").OrderBy(g => g.Key))
        {
            if (group.Count() != 2)
                Warn($"Teleporter {group.Key} needs exactly 2, and there {(group.Count() == 1 ? "is 1" : $"are {group.Count()}")}.");
        }

        foreach (var problem in FindStreamTraps(puzzle))
            Warn(problem);

        // A location's parts connect edge to edge - see PuzzleConnection.
        var next = node.Children.FirstOrDefault();
        if (next?.Puzzle is not null)
        {
            var finishes = puzzle.Objects.Where(o => o.Kind == PuzzleObjectKind.Finish).ToList();
            if (finishes.Count > 1)
                Warn($"it leads on to '{next.Card.HeadingText}', so it should have only one Finish.");
            else if (finishes.Count == 1 && PuzzleConnection.ExitDirectionOf(finishes[0].Col, finishes[0].Row) is null)
                Warn($"it leads on to '{next.Card.HeadingText}', so its Finish has to be on an edge of the board, not a corner.");
        }

        if (PuzzleConnection.EntranceAfter(previous?.Puzzle) is { } entrance)
        {
            var here = $"column {entrance.Col + 1}, row {entrance.Row + 1}";
            var start = puzzle.Objects.FirstOrDefault(o => o.Kind == PuzzleObjectKind.Start);
            if (PuzzleConnection.BlockingEntrance(puzzle, entrance) is { } blocking)
                Warn($"the ship comes in from '{previous!.Card.HeadingText}' at {here}, but a {blocking.Kind} is there. Clear that square to connect the boards.");
            else if (start is null || (start.Col, start.Row) != entrance)
                Warn($"its Start isn't where the ship comes in from '{previous!.Card.HeadingText}', at {here}. Open the Puzzle Editor to line it up.");
        }

        var hasRotatorTiles = puzzle.Objects.Any(o => o.Kind == PuzzleObjectKind.RotatorTile);
        var hasRotatorSwitch = puzzle.Objects.Any(o => o.Kind == PuzzleObjectKind.RotatorSwitch);
        if (hasRotatorTiles && !hasRotatorSwitch)
            Warn("it has Rotator tiles but no Rotator Switch, so they'll never move.");
        if (hasRotatorSwitch && !hasRotatorTiles)
            Warn("it has a Rotator Switch but no Rotator tiles, so it does nothing.");

        var hasPipes = puzzle.Objects.Any(o => o.Kind == PuzzleObjectKind.Pipe);
        if (puzzle.Objects.Any(o => o.Kind == PuzzleObjectKind.PipeSwitch) && !hasPipes)
            Warn("it has a Pipe Switch but no Pipes, so it does nothing.");

        if (puzzle.Objects.Any(o => o.Invisible) && puzzle.Objects.All(o => o.Kind != PuzzleObjectKind.Lantern))
            Warn("it has invisible objects but no Lantern, so they can never be seen.");

        // Push Blocks only ever go by sinking with another of their symbol.
        var blocks = puzzle.Objects.Where(o => o.Kind == PuzzleObjectKind.PushBlock).ToList();
        foreach (var lone in blocks.GroupBy(o => o.Symbol).Where(g => g.Count() == 1).OrderBy(g => g.Key))
            Warn($"its only {lone.Key} block has nothing to sink with.");
        var touching = blocks.Where(o => blocks.Any(other => other != o && other.Symbol == o.Symbol && Math.Abs(other.Col - o.Col) + Math.Abs(other.Row - o.Row) == 1))
            .Select(o => o.Symbol).Distinct().OrderBy(symbol => symbol);
        foreach (var symbol in touching)
            Warn($"two {symbol} blocks start side by side, so they'll sink as soon as anything moves.");

        foreach (var jump in puzzle.Objects.Where(o => o.Kind == PuzzleObjectKind.JumpTile))
        {
            if (JumpLanding(puzzle, jump) is null)
                Warn($"the Jump Tile at column {jump.Col + 1}, row {jump.Row + 1} has nowhere to land, so it does nothing.");
        }

        var missingDrawings = puzzle.Objects
            .Where(o => o.Variant is not null && drawings?.Any(d => d.Id == o.Variant && d.Kind == o.Kind) != true)
            .GroupBy(o => (o.Kind, o.Variant))
            .OrderBy(g => g.Key.Kind.ToString()).ThenBy(g => g.Key.Variant);
        foreach (var group in missingDrawings)
            Warn($"{(group.Count() == 1 ? $"a {group.Key.Kind} uses" : $"{group.Count()} {group.Key.Kind}s use")} drawing '{group.Key.Variant}', which isn't in the library, so {(group.Count() == 1 ? "it's" : "they're")} drawn as Standard.");
    }

    // Where a Jump Tile would land the ship as the puzzle starts: 2 squares along, or 1, on the board and without
    // anything solid there - see runtime/puzzle.js's jumpFrom. Null if neither.
    private static (int Col, int Row)? JumpLanding(Puzzle puzzle, PuzzleObject jump)
    {
        var (dx, dy) = jump.Direction switch
        {
            PuzzleDirection.Up => (0, -1),
            PuzzleDirection.Down => (0, 1),
            PuzzleDirection.Left => (-1, 0),
            _ => (1, 0),
        };
        foreach (var distance in new[] { 2, 1 })
        {
            var (col, row) = (jump.Col + dx * distance, jump.Row + dy * distance);
            var onBoard = col >= 0 && col < Puzzle.BoardSize && row >= 0 && row < Puzzle.BoardSize;
            var solid = puzzle.Objects.Any(o => o.Col == col && o.Row == row
                && (o.Kind is PuzzleObjectKind.Wall or PuzzleObjectKind.PushBlock || (o.Kind == PuzzleObjectKind.Gate && !o.Open)));
            if (onBoard && !solid)
                return (col, row);
        }
        return null;
    }

    // A Stream holds the ship until it pushes it off, so a path with no way off is somewhere a ship can only
    // get out of by restarting. Each path is followed to where it ends, and each ending reported once.
    private static IEnumerable<string> FindStreamTraps(Puzzle puzzle)
    {
        var streams = new Dictionary<(int Col, int Row), PuzzleObject>();
        var objects = new Dictionary<(int Col, int Row), PuzzleObject>();
        var rotatorTiles = puzzle.Objects.Where(o => o.Kind == PuzzleObjectKind.RotatorTile).Select(o => (o.Col, o.Row)).ToHashSet();
        foreach (var obj in puzzle.Objects)
        {
            if (obj.Kind is not (PuzzleObjectKind.RotatorTile or PuzzleObjectKind.Pipe))
                (obj.Kind == PuzzleObjectKind.Stream ? streams : objects).TryAdd((obj.Col, obj.Row), obj);
        }

        var reported = new HashSet<(int Col, int Row)>();

        foreach (var first in streams.Values)
        {
            var path = new List<(int Col, int Row)>();
            var current = first;

            while (true)
            {
                var here = (current.Col, current.Row);

                var seenAt = path.IndexOf(here);
                if (seenAt >= 0)
                {
                    // Named by the same square of the loop, wherever the path came into it from.
                    var loop = path.Skip(seenAt).OrderBy(c => c.Row).ThenBy(c => c.Col).First();
                    if (reported.Add(loop))
                        yield return $"{DescribeStream(loop)} is part of a loop, so a ship on it can only restart.";
                    break;
                }
                path.Add(here);

                // Something on the path that takes the ship away means it never gets as far as the ending.
                if (objects.TryGetValue(here, out var on) && on.Kind is PuzzleObjectKind.Teleporter or PuzzleObjectKind.Finish)
                    break;

                var next = Step(here, current.Direction);
                string? ending = null;

                if (next.Col < 0 || next.Col >= Puzzle.BoardSize || next.Row < 0 || next.Row >= Puzzle.BoardSize)
                    ending = "runs off the board";
                else if (streams.TryGetValue(next, out var nextStream))
                {
                    if (Step(next, nextStream.Direction) != here)
                    {
                        current = nextStream;
                        continue;
                    }
                    ending = "faces another Stream head-on";
                }
                // A Wall on a Rotator tile can be moved out of the way, so that's no dead end.
                else if (objects.TryGetValue(next, out var blocking) && blocking.Kind == PuzzleObjectKind.Wall && !rotatorTiles.Contains(next))
                    ending = "ends at a Wall";

                if (ending is not null && reported.Add(here))
                    yield return $"{DescribeStream(here)} {ending}, so a ship on it can only restart.";
                break;
            }
        }
    }

    private static string DescribeStream((int Col, int Row) cell) => $"The Stream at column {cell.Col + 1}, row {cell.Row + 1}";

    private static (int Col, int Row) Step((int Col, int Row) cell, PuzzleDirection? direction) => direction switch
    {
        PuzzleDirection.Up => (cell.Col, cell.Row - 1),
        PuzzleDirection.Down => (cell.Col, cell.Row + 1),
        PuzzleDirection.Left => (cell.Col - 1, cell.Row),
        _ => (cell.Col + 1, cell.Row),
    };

    private static void CheckGridPlacement(WeaveProject project, Page page, List<ValidationIssue> issues)
    {
        var grid = GridLayout.For(page, project);
        var mapNodes = page.Nodes.Where(n => n.Card.Size != CardSize.Modal).ToList();

        foreach (var node in mapNodes)
        {
            var (x, y) = grid.NodePositionFor(grid.CellOf(node));
            if (Math.Abs(node.X - x) > 0.5 || Math.Abs(node.Y - y) > 0.5)
            {
                issues.Add(new ValidationIssue
                {
                    Severity = ValidationSeverity.Warning,
                    Message = $"Node '{node.Id}' isn't centered in a grid square.",
                    PageId = page.Id,
                    NodeId = node.Id,
                });
            }
        }

        foreach (var group in mapNodes.GroupBy(grid.CellOf).Where(g => g.Count() > 1))
        {
            issues.Add(new ValidationIssue
            {
                Severity = ValidationSeverity.Warning,
                Message = $"Square {grid.LabelOf(group.Key)} has {group.Count()} locations on it ({string.Join(", ", group.Select(n => n.Id))}) - only the first can be reached.",
                PageId = page.Id,
            });
        }
    }

    private static void CheckEffect(Page page, PageEffect effect, string? assetBasePath, List<ValidationIssue> issues)
    {
        switch (effect)
        {
            case DriftingSpriteEffect drift:
                CheckAsset(drift.ImagePath, assetBasePath, "Effect sprite image", page.Id, null, issues);
                if (drift.DriftX is null && drift.DriftY is null)
                {
                    issues.Add(new ValidationIssue
                    {
                        Severity = ValidationSeverity.Warning,
                        Message = $"Drifting sprite effect '{effect.Id}' has no DriftX or DriftY - it won't move.",
                        PageId = page.Id,
                    });
                }
                break;

            case CrossfadeLayerEffect crossfade:
                CheckAsset(crossfade.ImagePath, assetBasePath, "Effect layer image", page.Id, null, issues);
                break;
        }
    }

    private static void CheckAsset(string relativePath, string? assetBasePath, string label, string pageId, string? nodeId, List<ValidationIssue> issues)
    {
        if (assetBasePath is null || string.IsNullOrEmpty(relativePath))
            return;

        if (!File.Exists(Path.Combine(assetBasePath, relativePath)))
        {
            issues.Add(new ValidationIssue
            {
                Severity = ValidationSeverity.Warning,
                Message = $"{label} not found: {relativePath}",
                PageId = pageId,
                NodeId = nodeId,
            });
        }
    }
}
