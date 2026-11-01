using TheWeave.Core.Model;

namespace TheWeave.Core.Tests;

public class GridLayoutTests
{
    [Fact]
    public void For_ExactSixTimesWorld_GivesWholePixelSquaresBelowTheTopLabelStrip()
    {
        var project = new WeaveProject { DefaultWorldWidthPx = 3000, DefaultWorldHeightPx = 1686 };

        var grid = GridLayout.For(new Page(), project);

        Assert.Equal(20, grid.Columns);
        Assert.Equal(10, grid.Rows);
        Assert.Equal(150, grid.CellWidth);
        Assert.Equal(150, grid.CellHeight);
        Assert.Equal(0, grid.OriginX);
        Assert.Equal(150, grid.OriginY);
    }

    [Fact]
    public void For_StretchedWorld_StillFollowsTheDrawnLines()
    {
        var project = new WeaveProject { DefaultWorldWidthPx = 3010, DefaultWorldHeightPx = 1696 };

        var grid = GridLayout.For(new Page(), project);

        Assert.Equal(20, grid.Columns);
        Assert.Equal(3010 / 20.0, grid.CellWidth, 6);
        Assert.Equal(1696 * 25 / 281.0, grid.CellHeight, 6);
    }

    [Fact]
    public void For_DoubleWidthMap_HasTwoSectorsSideBySide()
    {
        var project = new WeaveProject();
        var page = new Page { WorldWidthPx = 6000, WorldHeightPx = 1686 };

        var grid = GridLayout.For(page, project);

        Assert.Equal(40, grid.Columns);
        Assert.Equal(150, grid.CellWidth);
        Assert.Equal(3075, grid.ColumnCenter(20));
    }

    [Fact]
    public void Screens_SplitASingleMapIntoFourAlongSquareLines()
    {
        var grid = GridLayout.For(new Page(), new WeaveProject());

        Assert.Equal(1500, grid.ScreenWidth);
        Assert.Equal(798, grid.ScreenHeight);
        Assert.Equal(new double[] { 126, 876 }, grid.ScreenTops);
        Assert.Equal(new double[] { 1500 }, grid.ScreenLinesX);
        Assert.Equal(new double[] { 126, 900, 1674 }, grid.ScreenLinesY);
    }

    [Fact]
    public void Screens_FrameTheirRowsIdentically_WithEqualMarginsAboveAndBelow()
    {
        var grid = GridLayout.For(new Page(), new WeaveProject());

        var aboveRow0 = grid.RowCenter(0) - grid.CellHeight / 2 - grid.ScreenTops[0];
        var aboveRow5 = grid.RowCenter(5) - grid.CellHeight / 2 - grid.ScreenTops[1];
        var belowRow9 = grid.ScreenTops[1] + grid.ScreenHeight - (grid.RowCenter(9) + grid.CellHeight / 2);

        Assert.Equal(24, aboveRow0); // 4 source pixels: the A-S letters end just above this
        Assert.Equal(aboveRow0, aboveRow5);
        Assert.Equal(aboveRow0, belowRow9);
    }

    [Fact]
    public void Screens_SplitTheDoubleMapIntoEight()
    {
        var grid = GridLayout.For(new Page { WorldWidthPx = 6000, WorldHeightPx = 1686 }, new WeaveProject());

        Assert.Equal(new double[] { 1500, 3000, 4500 }, grid.ScreenLinesX);
    }

    [Fact]
    public void ColumnLabels_NameTheNumberColumnThenTheLetters()
    {
        var single = GridLayout.For(new Page(), new WeaveProject());
        Assert.Equal("#", single.ColumnLabel(0));
        Assert.Equal("A", single.ColumnLabel(1));
        Assert.Equal("S", single.ColumnLabel(19));
        Assert.Equal("#3", single.LabelOf(new GridCell(0, 3)));

        var twoSectors = GridLayout.For(new Page { WorldWidthPx = 6000, WorldHeightPx = 1686 }, new WeaveProject());
        Assert.Equal("Sector 1: S", twoSectors.ColumnLabel(19));
        Assert.Equal("Sector 2: #", twoSectors.ColumnLabel(20));
        Assert.Equal("Sector 2: A", twoSectors.ColumnLabel(21));
    }

    [Fact]
    public void NumberColumn_IsAProperSquareOnTheGrid()
    {
        var grid = GridLayout.For(new Page(), new WeaveProject());

        Assert.True(grid.IsOnSquare(75, 225));
        Assert.Equal(new GridCell(0, 0), grid.CellAt(75, 225));
        Assert.Equal((51d, 201d), grid.NodePositionFor(new GridCell(0, 0)));
        Assert.False(grid.IsOnSquare(75, 75)); // the top label strip still isn't
    }
}
