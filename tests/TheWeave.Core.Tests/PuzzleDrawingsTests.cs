using TheWeave.Core.Model;
using Xunit;

namespace TheWeave.Core.Tests;

public class PuzzleDrawingsTests
{
    private static Puzzle WithCrane() => new()
    {
        Objects =
        [
            new PuzzleObject { Kind = PuzzleObjectKind.Crane, Col = 1, Row = 1, Letter = "A" },
            new PuzzleObject { Kind = PuzzleObjectKind.Crane, Col = 5, Row = 5, Letter = "A" },
        ],
    };

    private static PuzzleDrawing Redrawn(PuzzleObjectKind kind) => new()
    {
        Id = kind.ToString(), Kind = kind, Name = "Mine", Pixels = new string('.', PuzzleDrawings.TilePixels),
    };

    [Fact]
    public void UsedBy_BringsACranesClawAlong_EvenThoughNoObjectIsDrawnWithIt()
    {
        var library = new List<PuzzleDrawing> { Redrawn(PuzzleObjectKind.Crane), Redrawn(PuzzleObjectKind.CraneArm) };

        var used = PuzzleDrawings.UsedBy(WithCrane(), library);

        // The claw is drawn by the board itself rather than by an object on it, so nothing points at its drawing: the
        // site would draw the Standard claw however it was redrawn. See ArchetonDefinitions.DrawingsOf's Laser.
        Assert.Contains(used, drawing => drawing.Kind == PuzzleObjectKind.CraneArm);
        Assert.Contains(used, drawing => drawing.Kind == PuzzleObjectKind.Crane);
    }

    [Fact]
    public void UsedBy_LeavesAClawOutOfABoardWithNoCrane()
    {
        var library = new List<PuzzleDrawing> { Redrawn(PuzzleObjectKind.CraneArm) };
        var puzzle = new Puzzle { Objects = [new PuzzleObject { Kind = PuzzleObjectKind.Wall }] };

        Assert.Empty(PuzzleDrawings.UsedBy(puzzle, library));
    }
}
