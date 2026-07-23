import CoreGraphics

public enum OverlayLayout {
    public static func reactionBarFrame(
        target: CGRect,
        visibleScreen: CGRect,
        barSize: CGSize,
        gap: CGFloat = 10
    ) -> CGRect {
        let unclampedX = target.midX - barSize.width / 2
        let x = min(
            max(unclampedX, visibleScreen.minX + 8),
            visibleScreen.maxX - barSize.width - 8
        )

        let aboveY = target.maxY + gap
        let belowY = target.minY - barSize.height - gap
        let y: CGFloat

        if aboveY + barSize.height <= visibleScreen.maxY {
            y = aboveY
        } else if belowY >= visibleScreen.minY {
            y = belowY
        } else {
            y = min(
                max(aboveY, visibleScreen.minY + 8),
                visibleScreen.maxY - barSize.height - 8
            )
        }

        return CGRect(origin: CGPoint(x: x, y: y), size: barSize)
    }

    public static func highlightFrame(
        target: CGRect,
        visibleScreen: CGRect,
        outset: CGFloat = 4
    ) -> CGRect {
        target
            .insetBy(dx: -outset, dy: -outset)
            .intersection(visibleScreen)
    }

    public static func shouldDismiss(
        pointer: CGPoint,
        target: CGRect,
        reactionBar: CGRect,
        targetTolerance: CGFloat = 6
    ) -> Bool {
        !target.insetBy(dx: -targetTolerance, dy: -targetTolerance)
            .contains(pointer)
            && !reactionBar.insetBy(dx: -2, dy: -2).contains(pointer)
    }
}
