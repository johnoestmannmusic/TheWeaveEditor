namespace TheWeave.Importer;

/// <summary>
/// Something the importer noticed and handled but couldn't be fully confident about - a
/// skipped backup file, an unrecognized script pattern, a dropped query string. Surfaced
/// so nothing is silently mis-imported.
/// </summary>
public sealed record ImportWarning(string Message, string? PageId = null, string? NodeId = null)
{
    public override string ToString() =>
        PageId is null ? Message : $"[{PageId}{(NodeId is null ? "" : $"/{NodeId}")}] {Message}";
}
