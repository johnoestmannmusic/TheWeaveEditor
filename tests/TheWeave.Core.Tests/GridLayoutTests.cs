using TheWeave.Core.Model;

namespace TheWeave.Core.Tests;

public class GridLayoutTests
{
    [Fact]
    public void For_ExactSixTimesWorld_GivesWholePixelSquaresPastTheLabelStrips()
    {
        var project = new WeaveProject { DefaultWorldWidthPx = 3000, DefaultWorldHeightPx = 1686 };

        var grid = GridLayout.For(new Page(), project);

        Assert.Equal(19, grid.Columns);
        Assert.Equal(10, grid.Rows);
        Assert.Equal(150, grid.CellWidth);
        Assert.Equal(150, grid.CellHeight);
        Assert.Equal(150, grid.OriginX);
        Assert.Equal(150, grid.OriginY);
        Assert.Empty(grid.GapColumns);
    }

    [Fact]
    public void For_StretchedWorld_StillFollowsTheDrawnLines()
    {
        var project = new WeaveProject { DefaultWorldWidthPx = 3010, DefaultWorldHeightPx = 1696 };

        var grid = GridLayout.For(new Page(), project);

        Assert.Equal(19, grid.Columns);
        Assert.Equal(3010 / 20.0, grid.CellWidth, 6);
        Assert.Equal(1696 * 25 / 281.0, grid.CellHeight, 6);
    }

    [Fact]
    public void For_DoubleWidthMap_HasTwoSectorsWithAGapBetweenThem()
    {
        var project = new WeaveProject();
        var page = new Page { WorldWidthPx = 6000, WorldHeightPx = 1686 };

        var grid = GridLayout.For(page, project);

        Assert.Equal(38, grid.Columns);
        Assert.Equal(150, grid.CellWidth);
        Assert.Equal(new[] { 19 }, grid.GapColumns);
    }
}
