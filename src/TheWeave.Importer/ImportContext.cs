using TheWeave.Core.Model;

namespace TheWeave.Importer;

/// <summary>Mutable state shared across parsing one whole site directory.</summary>
internal sealed class ImportContext
{
    public HashSet<string> UsedNodeIds { get; } = new(StringComparer.Ordinal);
    public List<ImportWarning> Warnings { get; } = new();

    /// <summary>
    /// Travel links can't be resolved to a TargetPageId until every page has been parsed
    /// (the target might not exist yet), so they're recorded here and resolved in a final pass.
    /// </summary>
    public List<PendingTravelLink> PendingTravelLinks { get; } = new();
}

internal sealed record PendingTravelLink(Node Node, string RawHref, string PageId);
