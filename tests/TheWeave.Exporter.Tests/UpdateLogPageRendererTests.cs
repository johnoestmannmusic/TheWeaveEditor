using TheWeave.Exporter.Templates;
using Xunit;

namespace TheWeave.Exporter.Tests;

public class UpdateLogPageRendererTests
{
    private static string Render(params string[] lines) => UpdateLogPageRenderer.Render(lines);

    [Fact]
    public void Render_DatedEntry_GetsADateLabelAndTheRestAsItsHeadline()
    {
        var html = Render("[26AUG26] Locations now Auto-Play and various other fixes!");

        Assert.Contains("<span class=\"date\">26AUG26</span>Locations now Auto-Play and various other fixes!", html);
    }

    [Fact]
    public void Render_IndentedFollowUpLines_BecomeANestedSubList()
    {
        var html = Render(
            "[10JUN26] Entry point is now The Weave:",
            "    Azurus released, with 6 locations",
            "    Pyron released, with 2 locations");

        Assert.Contains("<span class=\"date\">10JUN26</span>Entry point is now The Weave:<ul>" +
            "<li>Azurus released, with 6 locations</li>" +
            "<li>Pyron released, with 2 locations</li>" +
            "</ul></li>", html);
    }

    [Fact]
    public void Render_EntryWithoutADateTag_RendersWithNoDateLabel()
    {
        var html = Render("TWE Guided Tours are now available for those who would like a more structured look into The Weave.");

        Assert.DoesNotContain("class=\"date\"", html);
        Assert.Contains("<li>TWE Guided Tours are now available", html);
    }

    [Fact]
    public void Render_EachEntry_BecomesItsOwnTopLevelListItem_NewestFirst()
    {
        var html = Render(
            "[26AUG26] First entry",
            "",
            "[23AUG26] Second entry");

        Assert.Contains("<li><span class=\"date\">26AUG26</span>First entry</li>", html);
        Assert.Contains("<li><span class=\"date\">23AUG26</span>Second entry</li>", html);
        Assert.True(html.IndexOf("26AUG26", StringComparison.Ordinal) < html.IndexOf("23AUG26", StringComparison.Ordinal));
    }

    [Fact]
    public void Render_BareUrlInAnEntry_GetsHyperlinked()
    {
        var html = Render("[01JAN27] Read more at https://example.com/notes");

        Assert.Contains("<a href=\"https://example.com/notes\" target=\"_blank\" rel=\"noreferrer noopener\">https://example.com/notes</a>", html);
    }

    [Fact]
    public void Render_TitleAndSubtitle_AreTheSitesOwn()
    {
        var html = Render("[26AUG26] First entry");

        Assert.Contains("<title>Update Log</title>", html);
        Assert.Contains("<h1>Update Log</h1>", html);
        Assert.Contains("<p class=\"subtitle\">The Weave Explorer</p>", html);
    }

    [Fact]
    public void Render_ProducesAWellFormedPage()
    {
        var html = Render("[26AUG26] First entry");

        Assert.StartsWith("<!DOCTYPE html>", html);
        Assert.Contains("<ul class=\"updates\">", html);
        Assert.EndsWith("</html>\n", html.Replace("\r\n", "\n"));
    }

    [Fact]
    public void Render_WithNoEntries_IsAPageWithNothingInIt()
    {
        // The exporter decides whether to write the page at all (see SiteExporter) - this only has to not throw, and not
        // invent an entry.
        var html = UpdateLogPageRenderer.Render(null);

        Assert.Contains("<ul class=\"updates\">", html);
        Assert.DoesNotContain("<li>", html);
    }
}
