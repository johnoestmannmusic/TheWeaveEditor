using TheWeave.EditorApp;
using Xunit;

namespace TheWeave.EditorApp.Tests;

public class DrawingPngTests
{
    private static readonly byte[] TinyPng = Convert.FromBase64String(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==");

    [Fact]
    public void APng_RoundTripsThroughADataUrl()
    {
        var url = DrawingPng.ToDataUrl(TinyPng);

        Assert.StartsWith("data:image/png;base64,", url);
        Assert.Equal(TinyPng, DrawingPng.FromDataUrl(url));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("data:image/jpeg;base64,/9j/4AAQ")]
    [InlineData("data:image/png;base64,not base64!")]
    [InlineData("data:image/png;base64,R0lGODlhAQABAAAAACw=")]
    public void AnythingButAPngDataUrl_IsTurnedAway(string? dataUrl)
    {
        Assert.Throws<InvalidOperationException>(() => DrawingPng.FromDataUrl(dataUrl));
    }

    [Fact]
    public void AFileThatIsntAPng_OrIsFarTooBig_IsTurnedAway()
    {
        Assert.Contains("isn't a PNG", Assert.Throws<InvalidOperationException>(() => DrawingPng.ToDataUrl("GIF89a"u8.ToArray())).Message);

        var huge = new byte[DrawingPng.MaxBytes + 1];
        TinyPng.CopyTo(huge, 0);
        Assert.Contains("too large", Assert.Throws<InvalidOperationException>(() => DrawingPng.ToDataUrl(huge)).Message);
    }
}
