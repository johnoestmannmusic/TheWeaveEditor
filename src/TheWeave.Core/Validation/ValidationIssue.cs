namespace TheWeave.Core.Validation;

public enum ValidationSeverity
{
    Warning,
    Error,
}

public sealed class ValidationIssue
{
    public ValidationSeverity Severity { get; init; }
    public string Message { get; init; } = "";
    public string? PageId { get; init; }
    public string? NodeId { get; init; }

    public override string ToString() =>
        $"[{Severity}] {Message}" +
        (PageId is not null ? $" (page: {PageId}{(NodeId is not null ? $", node: {NodeId}" : "")})" : "");
}
