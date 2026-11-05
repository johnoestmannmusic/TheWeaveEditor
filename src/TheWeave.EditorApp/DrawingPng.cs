namespace TheWeave.EditorApp;

/// <summary>
/// The checks on an object drawing's PNG on its way to or from a file - see Program's ExportDrawingPng and
/// ImportDrawingPng. Only that it really is a PNG, and not an unreasonable size for a few 24x24 layers: what's
/// in it is the page's to read.
/// </summary>
public static class DrawingPng
{
    /// <summary>Far more than any drawing needs, even enlarged, but not a photo by mistake.</summary>
    public const int MaxBytes = 4 * 1024 * 1024;

    private const string DataUrlPrefix = "data:image/png;base64,";
    private static readonly byte[] Signature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

    public static byte[] FromDataUrl(string? dataUrl)
    {
        if (dataUrl is null || !dataUrl.StartsWith(DataUrlPrefix, StringComparison.Ordinal))
            throw new InvalidOperationException("The drawing couldn't be turned into a PNG.");

        byte[] bytes;
        try
        {
            bytes = Convert.FromBase64String(dataUrl[DataUrlPrefix.Length..]);
        }
        catch (FormatException)
        {
            throw new InvalidOperationException("The drawing couldn't be turned into a PNG.");
        }
        Check(bytes);
        return bytes;
    }

    public static string ToDataUrl(byte[] bytes)
    {
        Check(bytes);
        return DataUrlPrefix + Convert.ToBase64String(bytes);
    }

    private static void Check(byte[] bytes)
    {
        if (bytes.Length > MaxBytes)
            throw new InvalidOperationException("That image is too large to be a drawing.");
        if (bytes.Length < Signature.Length || !bytes.AsSpan(0, Signature.Length).SequenceEqual(Signature))
            throw new InvalidOperationException("That file isn't a PNG image.");
    }
}
