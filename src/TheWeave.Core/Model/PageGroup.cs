namespace TheWeave.Core.Model;

/// <summary>Editor-tree organization only (e.g. "Galaxy", "Planets", "Shrines") - no runtime meaning.</summary>
public sealed class PageGroup
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string? ParentGroupId { get; set; }
}
