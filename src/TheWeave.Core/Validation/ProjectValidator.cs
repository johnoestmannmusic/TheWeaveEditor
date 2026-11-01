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
                CheckNode(page, node, pageIds, assetBasePath, issues);

            CheckGridPlacement(project, page, issues);

            foreach (var effect in page.Effects)
                CheckEffect(page, effect, assetBasePath, issues);
        }

        return issues;
    }

    private static void CollectNodeIds(string pageId, IEnumerable<Node> nodes, List<(string, string)> into)
    {
        foreach (var node in nodes)
        {
            into.Add((pageId, node.Id));
            CollectNodeIds(pageId, node.Children, into);
        }
    }

    private static void CheckNode(Page page, Node node, HashSet<string> pageIds, string? assetBasePath, List<ValidationIssue> issues)
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

        foreach (var child in node.Children)
            CheckNode(page, child, pageIds, assetBasePath, issues);
    }

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
