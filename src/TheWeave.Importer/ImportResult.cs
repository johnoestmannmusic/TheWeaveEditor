using TheWeave.Core.Model;

namespace TheWeave.Importer;

public sealed class ImportResult
{
    public required WeaveProject Project { get; init; }
    public required IReadOnlyList<ImportWarning> Warnings { get; init; }
}
