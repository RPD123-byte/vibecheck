import AppKit
import ApplicationServices
import CoreGraphics
import Foundation
import HighlightCore

private struct Options {
    var demo = false
    var demoSeconds: TimeInterval?
    var debugAccessibility = false
    var fixture = false
    var fixtureAutoTest = false
    var requestPermission = false

    static func parse(_ arguments: [String]) -> Options {
        var options = Options()
        var index = 1

        while index < arguments.count {
            switch arguments[index] {
            case "--demo":
                options.demo = true
            case "--request-permission":
                options.requestPermission = true
            case "--debug-accessibility":
                options.debugAccessibility = true
            case "--fixture":
                options.fixture = true
            case "--fixture-auto-test":
                options.fixture = true
                options.fixtureAutoTest = true
            case "--demo-seconds":
                if arguments.indices.contains(index + 1) {
                    options.demoSeconds = TimeInterval(arguments[index + 1])
                    index += 1
                }
            case "--help", "-h":
                print(
                    """
                    Usage: highlight-and-react [options]

                      --demo                    Show the overlay without Accessibility access
                      --demo-seconds SECONDS    Exit automatically after a demo
                      --debug-accessibility     Log selection Accessibility details
                      --fixture                 Open a selectable keyboard-shortcut test window
                      --fixture-auto-test       Exercise element picking locally and exit
                      --request-permission      Ask macOS for Accessibility permission
                      --help                    Show this help
                    """
                )
                exit(0)
            default:
                fputs("Unknown option: \(arguments[index])\n", stderr)
                exit(2)
            }
            index += 1
        }

        return options
    }
}

private struct HighlightTarget {
    enum Kind: String {
        case text
        case element
    }

    let quartzFrame: CGRect
    let kind: Kind
    let role: String
    let text: String
    let applicationName: String

    var identity: String {
        [
            applicationName,
            role,
            "\(Int(quartzFrame.minX))",
            "\(Int(quartzFrame.minY))",
            "\(Int(quartzFrame.width))",
            "\(Int(quartzFrame.height))",
            text,
        ].joined(separator: "|")
    }
}

private enum AccessibilityValue {
    static func copy(_ attribute: String, from element: AXUIElement) -> CFTypeRef? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success else {
            return nil
        }
        return value
    }

    static func string(_ attribute: String, from element: AXUIElement) -> String? {
        copy(attribute, from: element) as? String
    }

    static func rect(from value: CFTypeRef) -> CGRect? {
        guard CFGetTypeID(value) == AXValueGetTypeID() else {
            return nil
        }
        var frame = CGRect.zero
        let axValue = unsafeBitCast(value, to: AXValue.self)
        guard
            AXValueGetType(axValue) == .cgRect,
            AXValueGetValue(axValue, .cgRect, &frame)
        else {
            return nil
        }
        return frame
    }

    static func point(from value: CFTypeRef) -> CGPoint? {
        guard CFGetTypeID(value) == AXValueGetTypeID() else {
            return nil
        }
        var point = CGPoint.zero
        let axValue = unsafeBitCast(value, to: AXValue.self)
        guard
            AXValueGetType(axValue) == .cgPoint,
            AXValueGetValue(axValue, .cgPoint, &point)
        else {
            return nil
        }
        return point
    }

    static func size(from value: CFTypeRef) -> CGSize? {
        guard CFGetTypeID(value) == AXValueGetTypeID() else {
            return nil
        }
        var size = CGSize.zero
        let axValue = unsafeBitCast(value, to: AXValue.self)
        guard
            AXValueGetType(axValue) == .cgSize,
            AXValueGetValue(axValue, .cgSize, &size)
        else {
            return nil
        }
        return size
    }

    static func frame(of element: AXUIElement) -> CGRect? {
        if let value = copy("AXFrame", from: element),
           let frame = rect(from: value)
        {
            return frame
        }
        guard
            let positionValue = copy(kAXPositionAttribute, from: element),
            let sizeValue = copy(kAXSizeAttribute, from: element),
            let position = point(from: positionValue),
            let size = size(from: sizeValue)
        else {
            return nil
        }
        return CGRect(origin: position, size: size)
    }

    static func parent(of element: AXUIElement) -> AXUIElement? {
        guard let value = copy(kAXParentAttribute, from: element) else {
            return nil
        }
        return unsafeBitCast(value, to: AXUIElement.self)
    }

    static func children(of element: AXUIElement) -> [AXUIElement] {
        guard let value = copy(kAXChildrenAttribute, from: element) else {
            return []
        }
        return value as? [AXUIElement] ?? []
    }

}

private final class TargetResolver {
    private let systemWide = AXUIElementCreateSystemWide()

    func resolveSelection(debugAccessibility: Bool) -> HighlightTarget? {
        let focusedValue = AccessibilityValue.copy(
            kAXFocusedUIElementAttribute,
            from: systemWide
        )

        if let focusedValue {
            var current: AXUIElement? = unsafeBitCast(
                focusedValue,
                to: AXUIElement.self
            )
            for depth in 0..<9 {
                guard let element = current else {
                    break
                }

                logSelectionElement(element, depth: depth, enabled: debugAccessibility)
                if let target = selection(from: element) {
                    logResolvedSelection(
                        target,
                        source: "focused-chain depth=\(depth)",
                        enabled: debugAccessibility
                    )
                    return target
                }
                current = AccessibilityValue.parent(of: element)
            }
        } else {
            debugSelection("No focused Accessibility element.", enabled: debugAccessibility)
        }

        if let target = searchActiveWindowForSelection(
            debugAccessibility: debugAccessibility
        ) {
            return target
        }

        debugSelection(
            "No non-empty Accessibility selection with usable bounds.",
            enabled: debugAccessibility
        )
        return nil
    }

    func resolveElement(
        at quartzPoint: CGPoint,
        excludingProcessIdentifier: pid_t?,
        debugAccessibility: Bool
    ) -> HighlightTarget? {
        var rawElement: AXUIElement?
        let error = AXUIElementCopyElementAtPosition(
            systemWide,
            Float(quartzPoint.x),
            Float(quartzPoint.y),
            &rawElement
        )
        guard error == .success, let rawElement else {
            debugSelection(
                "No Accessibility element at " +
                    "(\(Int(quartzPoint.x)),\(Int(quartzPoint.y))).",
                enabled: debugAccessibility
            )
            return nil
        }

        var current: AXUIElement? = rawElement
        for depth in 0..<8 {
            guard let element = current else {
                break
            }
            if let target = elementTarget(
                from: element,
                excludingProcessIdentifier: excludingProcessIdentifier
            ) {
                debugSelection(
                    "element source=point depth=\(depth) role=\(target.role) " +
                        "frame=(\(Int(target.quartzFrame.minX))," +
                        "\(Int(target.quartzFrame.minY))," +
                        "\(Int(target.quartzFrame.width))," +
                        "\(Int(target.quartzFrame.height))) " +
                        "text=\(target.text.prefix(120))",
                    enabled: debugAccessibility
                )
                return target
            }
            current = AccessibilityValue.parent(of: element)
        }

        debugSelection(
            "No usable Accessibility element at pointer.",
            enabled: debugAccessibility
        )
        return nil
    }

    private func selection(from element: AXUIElement) -> HighlightTarget? {
        rangeSelection(from: element) ?? markerSelection(from: element)
    }

    private func searchActiveWindowForSelection(
        debugAccessibility: Bool
    ) -> HighlightTarget? {
        guard let applicationValue = AccessibilityValue.copy(
            kAXFocusedApplicationAttribute,
            from: systemWide
        ) else {
            return nil
        }
        let application = unsafeBitCast(applicationValue, to: AXUIElement.self)
        let root: AXUIElement
        if let windowValue = AccessibilityValue.copy(
            kAXFocusedWindowAttribute,
            from: application
        ) {
            root = unsafeBitCast(windowValue, to: AXUIElement.self)
        } else {
            root = application
        }

        var queue: [AXUIElement] = [root]
        var index = 0
        let maximumElements = 600

        while index < queue.count, index < maximumElements {
            let element = queue[index]
            index += 1

            if let target = selection(from: element) {
                logResolvedSelection(
                    target,
                    source: "active-window-search element=\(index)",
                    enabled: debugAccessibility
                )
                return target
            }
            queue.append(contentsOf: AccessibilityValue.children(of: element))
        }

        debugSelection(
            "Active-window selection search inspected \(min(index, maximumElements)) elements.",
            enabled: debugAccessibility
        )
        return nil
    }

    private func logResolvedSelection(
        _ target: HighlightTarget,
        source: String,
        enabled: Bool
    ) {
        debugSelection(
            "selection source=\(source) role=\(target.role) " +
                "frame=(\(Int(target.quartzFrame.minX))," +
                "\(Int(target.quartzFrame.minY))," +
                "\(Int(target.quartzFrame.width))," +
                "\(Int(target.quartzFrame.height))) " +
                "text=\(target.text.prefix(120))",
            enabled: enabled
        )
    }

    private func logSelectionElement(
        _ element: AXUIElement,
        depth: Int,
        enabled: Bool
    ) {
        guard enabled else {
            return
        }

        let role = AccessibilityValue.string(kAXRoleAttribute, from: element)
            ?? "AXUnknown"
        let selectedText = AccessibilityValue.string(
            kAXSelectedTextAttribute,
            from: element
        ) ?? ""
        let hasRange = AccessibilityValue.copy(
            kAXSelectedTextRangeAttribute,
            from: element
        ) != nil
        let hasMarkerRange = AccessibilityValue.copy(
            "AXSelectedTextMarkerRange",
            from: element
        ) != nil
        var parameterizedNames: CFArray?
        AXUIElementCopyParameterizedAttributeNames(element, &parameterizedNames)
        let names = (parameterizedNames as? [String] ?? [])
            .joined(separator: ",")

        fputs(
            "selection-element depth=\(depth) role=\(role) " +
                "selected-length=\(selectedText.count) range=\(hasRange) " +
                "marker-range=\(hasMarkerRange) parameterized=[\(names)]\n",
            stderr
        )
        fflush(stderr)
    }

    private func rangeSelection(from element: AXUIElement) -> HighlightTarget? {
        guard
            let text = AccessibilityValue.string(kAXSelectedTextAttribute, from: element)?
                .trimmingCharacters(in: .whitespacesAndNewlines),
            !text.isEmpty,
            let selectedRange = AccessibilityValue.copy(
                kAXSelectedTextRangeAttribute,
                from: element
            ),
            let frame = parameterizedFrame(
                attribute: "AXBoundsForRange",
                parameter: selectedRange,
                element: element
            )
        else {
            return nil
        }

        return selectionTarget(element: element, text: text, frame: frame)
    }

    private func markerSelection(from element: AXUIElement) -> HighlightTarget? {
        guard
            let markerRange = AccessibilityValue.copy(
                "AXSelectedTextMarkerRange",
                from: element
            ),
            let frame = parameterizedFrame(
                attribute: "AXBoundsForTextMarkerRange",
                parameter: markerRange,
                element: element
            ),
            let textValue = parameterizedValue(
                attribute: "AXStringForTextMarkerRange",
                parameter: markerRange,
                element: element
            ) as? String
        else {
            return nil
        }

        let text = textValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else {
            return nil
        }
        return selectionTarget(element: element, text: text, frame: frame)
    }

    private func parameterizedFrame(
        attribute: String,
        parameter: CFTypeRef,
        element: AXUIElement
    ) -> CGRect? {
        guard let value = parameterizedValue(
            attribute: attribute,
            parameter: parameter,
            element: element
        ) else {
            return nil
        }
        return AccessibilityValue.rect(from: value)
    }

    private func parameterizedValue(
        attribute: String,
        parameter: CFTypeRef,
        element: AXUIElement
    ) -> CFTypeRef? {
        var value: CFTypeRef?
        guard AXUIElementCopyParameterizedAttributeValue(
            element,
            attribute as CFString,
            parameter,
            &value
        ) == .success else {
            return nil
        }
        return value
    }

    private func selectionTarget(
        element: AXUIElement,
        text: String,
        frame: CGRect
    ) -> HighlightTarget? {
        guard frame.width >= 1, frame.height >= 1 else {
            return nil
        }

        var pid: pid_t = 0
        AXUIElementGetPid(element, &pid)
        let applicationName = NSRunningApplication(processIdentifier: pid)?
            .localizedName ?? "Unknown app"
        let role = AccessibilityValue.string(kAXRoleAttribute, from: element)
            ?? "AXUnknown"

        return HighlightTarget(
            quartzFrame: frame,
            kind: .text,
            role: role,
            text: String(text.prefix(280)),
            applicationName: applicationName
        )
    }

    private func elementTarget(
        from element: AXUIElement,
        excludingProcessIdentifier: pid_t?
    ) -> HighlightTarget? {
        var pid: pid_t = 0
        guard AXUIElementGetPid(element, &pid) == .success else {
            return nil
        }
        if let excludingProcessIdentifier, pid == excludingProcessIdentifier {
            return nil
        }

        let role = AccessibilityValue.string(kAXRoleAttribute, from: element)
            ?? "AXUnknown"
        guard ![
            kAXApplicationRole,
            kAXSystemWideRole,
            kAXWindowRole,
            kAXMenuBarRole,
        ].contains(role) else {
            return nil
        }
        guard let frame = AccessibilityValue.frame(of: element),
              frame.width >= 4,
              frame.height >= 4,
              frame.width.isFinite,
              frame.height.isFinite
        else {
            return nil
        }

        let text = [
            AccessibilityValue.string(kAXTitleAttribute, from: element),
            AccessibilityValue.string(kAXDescriptionAttribute, from: element),
            AccessibilityValue.string(kAXValueAttribute, from: element),
            AccessibilityValue.string(kAXHelpAttribute, from: element),
        ]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .first { !$0.isEmpty }
            ?? role.replacingOccurrences(of: "AX", with: "")

        let applicationName = NSRunningApplication(processIdentifier: pid)?
            .localizedName ?? "Unknown app"
        return HighlightTarget(
            quartzFrame: frame,
            kind: .element,
            role: role,
            text: String(text.prefix(280)),
            applicationName: applicationName
        )
    }

    private func debugSelection(_ message: String, enabled: Bool) {
        guard enabled else {
            return
        }
        fputs("\(message)\n", stderr)
        fflush(stderr)
    }

}

private enum ScreenCoordinates {
    static func appKitRect(fromQuartz rect: CGRect) -> (CGRect, NSScreen)? {
        guard let screen = screen(containingQuartzPoint: CGPoint(x: rect.midX, y: rect.midY)),
              let displayID = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")]
                as? CGDirectDisplayID
        else {
            return nil
        }

        let quartzScreen = CGDisplayBounds(displayID)
        let x = screen.frame.minX + (rect.minX - quartzScreen.minX)
        let y = screen.frame.maxY - (rect.minY - quartzScreen.minY) - rect.height
        return (CGRect(x: x, y: y, width: rect.width, height: rect.height), screen)
    }

    static func appKitPoint(fromQuartz point: CGPoint) -> CGPoint? {
        guard let screen = screen(containingQuartzPoint: point),
              let displayID = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")]
                as? CGDirectDisplayID
        else {
            return nil
        }

        let quartzScreen = CGDisplayBounds(displayID)
        return CGPoint(
            x: screen.frame.minX + (point.x - quartzScreen.minX),
            y: screen.frame.maxY - (point.y - quartzScreen.minY)
        )
    }

    static func quartzPoint(fromAppKit point: CGPoint) -> CGPoint? {
        guard let screen = NSScreen.screens.first(where: { $0.frame.contains(point) }),
              let displayID = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")]
                as? CGDirectDisplayID
        else {
            return nil
        }

        let quartzScreen = CGDisplayBounds(displayID)
        return CGPoint(
            x: quartzScreen.minX + (point.x - screen.frame.minX),
            y: quartzScreen.minY + (screen.frame.maxY - point.y)
        )
    }

    static func quartzRect(fromAppKit rect: CGRect) -> CGRect? {
        guard let screen = NSScreen.screens.first(where: {
            $0.frame.contains(CGPoint(x: rect.midX, y: rect.midY))
        }),
              let displayID = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")]
                as? CGDirectDisplayID
        else {
            return nil
        }

        let quartzScreen = CGDisplayBounds(displayID)
        return CGRect(
            x: quartzScreen.minX + (rect.minX - screen.frame.minX),
            y: quartzScreen.minY + (screen.frame.maxY - rect.maxY),
            width: rect.width,
            height: rect.height
        )
    }

    private static func screen(containingQuartzPoint point: CGPoint) -> NSScreen? {
        NSScreen.screens.first { screen in
            guard let displayID = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")]
                as? CGDirectDisplayID
            else {
                return false
            }
            return CGDisplayBounds(displayID).contains(point)
        } ?? NSScreen.main
    }
}

private final class HighlightView: NSView {
    enum Style {
        case text
        case elementPreview
        case elementLocked
    }

    var style: Style = .text {
        didSet {
            needsDisplay = true
        }
    }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        let path = NSBezierPath(
            roundedRect: bounds.insetBy(dx: 2, dy: 2),
            xRadius: 10,
            yRadius: 10
        )
        let color: NSColor
        switch style {
        case .text:
            color = .systemYellow
        case .elementPreview, .elementLocked:
            color = .systemBlue
        }
        color.withAlphaComponent(style == .elementPreview ? 0.09 : 0.13).setFill()
        path.fill()
        color.withAlphaComponent(0.92).setStroke()
        path.lineWidth = 2.5
        if style == .elementPreview {
            path.setLineDash([6, 4], count: 2, phase: 0)
        }
        path.stroke()
    }
}

private final class OverlayController: NSObject {
    private let highlightPanel: NSPanel
    private let reactionPanel: NSPanel
    private let stackView: NSStackView
    private var currentTarget: HighlightTarget?
    private var currentTargetFrame: CGRect?
    private var previewIdentity: String?
    private let reactions = ["❤️", "👍", "👎", "😂", "‼️", "❓"]

    override init() {
        highlightPanel = NSPanel(
            contentRect: .zero,
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        reactionPanel = NSPanel(
            contentRect: .zero,
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        stackView = NSStackView()
        super.init()
        configurePanels()
    }

    var hasLockedTarget: Bool {
        currentTarget != nil
    }

    var hasPreview: Bool {
        previewIdentity != nil
    }

    @discardableResult
    func showPreview(target: HighlightTarget) -> Bool {
        guard target.kind == .element,
              let (targetFrame, screen) = ScreenCoordinates.appKitRect(
                fromQuartz: target.quartzFrame
              )
        else {
            return false
        }
        if previewIdentity == target.identity {
            return true
        }

        currentTarget = nil
        currentTargetFrame = nil
        previewIdentity = target.identity
        reactionPanel.orderOut(nil)
        let highlightFrame = OverlayLayout.highlightFrame(
            target: targetFrame,
            visibleScreen: screen.visibleFrame,
            outset: 3
        )
        (highlightPanel.contentView as? HighlightView)?.style = .elementPreview
        highlightPanel.setFrame(highlightFrame, display: true)
        highlightPanel.orderFrontRegardless()
        return true
    }

    func hidePreview() {
        guard currentTarget == nil else {
            return
        }
        previewIdentity = nil
        highlightPanel.orderOut(nil)
    }

    @discardableResult
    func show(target: HighlightTarget) -> Bool {
        guard let (targetFrame, screen) = ScreenCoordinates.appKitRect(
            fromQuartz: target.quartzFrame
        ) else {
            return false
        }

        currentTarget = target
        currentTargetFrame = targetFrame
        previewIdentity = nil
        let highlightFrame = OverlayLayout.highlightFrame(
            target: targetFrame,
            visibleScreen: screen.visibleFrame
        )
        let barFrame = OverlayLayout.reactionBarFrame(
            target: targetFrame,
            visibleScreen: screen.visibleFrame,
            barSize: CGSize(width: 292, height: 48)
        )

        (highlightPanel.contentView as? HighlightView)?.style =
            target.kind == .text ? .text : .elementLocked
        highlightPanel.setFrame(highlightFrame, display: true)
        reactionPanel.setFrame(barFrame, display: true)
        highlightPanel.orderFrontRegardless()
        reactionPanel.orderFrontRegardless()
        return true
    }

    func hide() {
        highlightPanel.orderOut(nil)
        reactionPanel.orderOut(nil)
        currentTarget = nil
        currentTargetFrame = nil
        previewIdentity = nil
    }

    @discardableResult
    func dismissIfPointerIsOutside(quartzPoint: CGPoint) -> Bool {
        guard currentTarget != nil,
              let currentTargetFrame,
              let appKitPoint = ScreenCoordinates.appKitPoint(fromQuartz: quartzPoint)
        else {
            return false
        }
        guard OverlayLayout.shouldDismiss(
            pointer: appKitPoint,
            target: currentTargetFrame,
            reactionBar: reactionPanel.frame
        ) else {
            return false
        }

        hide()
        return true
    }

    private func configurePanels() {
        for panel in [highlightPanel, reactionPanel] {
            panel.level = NSWindow.Level(rawValue: NSWindow.Level.statusBar.rawValue + 1)
            panel.backgroundColor = .clear
            panel.isOpaque = false
            panel.hasShadow = false
            panel.hidesOnDeactivate = false
            panel.collectionBehavior = [
                .canJoinAllSpaces,
                .fullScreenAuxiliary,
                .transient,
                .ignoresCycle,
            ]
        }
        highlightPanel.ignoresMouseEvents = true
        let highlightView = HighlightView(frame: .zero)
        highlightView.setAccessibilityElement(false)
        highlightPanel.contentView = highlightView
        highlightPanel.setAccessibilityElement(false)

        reactionPanel.hasShadow = true
        reactionPanel.becomesKeyOnlyIfNeeded = true

        let effect = NSVisualEffectView(frame: CGRect(x: 0, y: 0, width: 292, height: 48))
        effect.material = .popover
        effect.blendingMode = .behindWindow
        effect.state = .active
        effect.wantsLayer = true
        effect.layer?.cornerRadius = 17
        effect.layer?.masksToBounds = true
        effect.layer?.borderWidth = 0.5
        effect.layer?.borderColor = NSColor.separatorColor.cgColor

        stackView.orientation = .horizontal
        stackView.alignment = .centerY
        stackView.distribution = .fillEqually
        stackView.spacing = 2
        stackView.translatesAutoresizingMaskIntoConstraints = false

        for (index, reaction) in reactions.enumerated() {
            let button = NSButton(
                title: reaction,
                target: self,
                action: #selector(chooseReaction(_:))
            )
            button.tag = index
            button.isBordered = false
            button.font = .systemFont(ofSize: 22)
            button.toolTip = "React \(reaction)"
            stackView.addArrangedSubview(button)
        }

        effect.addSubview(stackView)
        NSLayoutConstraint.activate([
            stackView.leadingAnchor.constraint(equalTo: effect.leadingAnchor, constant: 8),
            stackView.trailingAnchor.constraint(equalTo: effect.trailingAnchor, constant: -8),
            stackView.topAnchor.constraint(equalTo: effect.topAnchor, constant: 5),
            stackView.bottomAnchor.constraint(equalTo: effect.bottomAnchor, constant: -5),
        ])
        reactionPanel.contentView = effect
    }

    @objc private func chooseReaction(_ sender: NSButton) {
        guard reactions.indices.contains(sender.tag), let target = currentTarget else {
            return
        }

        let payload: [String: Any] = [
            "event": "reaction",
            "reaction": reactions[sender.tag],
            "targetType": target.kind.rawValue,
            "application": target.applicationName,
            "role": target.role,
            "text": target.text,
            "bounds": [
                "x": target.quartzFrame.origin.x,
                "y": target.quartzFrame.origin.y,
                "width": target.quartzFrame.width,
                "height": target.quartzFrame.height,
            ],
            "timestamp": ISO8601DateFormatter().string(from: Date()),
        ]

        if let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]),
           let line = String(data: data, encoding: .utf8)
        {
            print(line)
            fflush(stdout)
        }
        hide()
    }
}

private final class InputMonitor {
    private var eventTap: CFMachPort?
    private var runLoopSource: CFRunLoopSource?
    private var localKeyMonitor: Any?
    private var localPointerMonitor: Any?
    private var localPointerMoveMonitor: Any?
    private let shouldTrackPointerMoves: () -> Bool
    private let onPointerMove: (CGPoint) -> Void
    private let onPointerDown: (CGPoint) -> Bool
    private let onCancel: () -> Bool
    private let onKeyboardShortcut: () -> Void
    private let debugEvents: Bool
    private var previousShortcutTime: TimeInterval = 0

    init(
        debugEvents: Bool,
        shouldTrackPointerMoves: @escaping () -> Bool,
        onPointerMove: @escaping (CGPoint) -> Void,
        onPointerDown: @escaping (CGPoint) -> Bool,
        onCancel: @escaping () -> Bool,
        onKeyboardShortcut: @escaping () -> Void
    ) {
        self.debugEvents = debugEvents
        self.shouldTrackPointerMoves = shouldTrackPointerMoves
        self.onPointerMove = onPointerMove
        self.onPointerDown = onPointerDown
        self.onCancel = onCancel
        self.onKeyboardShortcut = onKeyboardShortcut
    }

    func start(globalEvents: Bool = true) -> Bool {
        if globalEvents {
            let mask =
                CGEventMask(1 << CGEventType.mouseMoved.rawValue) |
                CGEventMask(1 << CGEventType.leftMouseDown.rawValue) |
                CGEventMask(1 << CGEventType.keyDown.rawValue)
            let callback: CGEventTapCallBack = { _, type, event, userInfo in
                guard let userInfo else {
                    return Unmanaged.passUnretained(event)
                }

                let monitor = Unmanaged<InputMonitor>
                    .fromOpaque(userInfo)
                    .takeUnretainedValue()

                switch type {
                case .tapDisabledByTimeout, .tapDisabledByUserInput:
                    if let eventTap = monitor.eventTap {
                        CGEvent.tapEnable(tap: eventTap, enable: true)
                    }
                case .mouseMoved:
                    if monitor.shouldTrackPointerMoves() {
                        let point = event.location
                        DispatchQueue.main.async {
                            monitor.receivePointerMove(point: point)
                        }
                    }
                case .leftMouseDown:
                    let point = event.location
                    if monitor.receivePointerDown(point: point) {
                        return nil
                    }
                case .keyDown:
                    let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
                    let isRepeat = event.getIntegerValueField(.keyboardEventAutorepeat) != 0
                    let flags = event.flags
                    let isShortcut = monitor.isKeyboardShortcut(
                        keyCode: keyCode,
                        flags: flags
                    )
                    let isCancel = monitor.isCancelKey(keyCode: keyCode, flags: flags)
                    if isCancel, monitor.receiveCancel() {
                        return nil
                    }
                    DispatchQueue.main.async {
                        monitor.receiveKeyDown(
                            keyCode: keyCode,
                            flags: flags,
                            isRepeat: isRepeat
                        )
                    }
                    if isShortcut {
                        return nil
                    }
                default:
                    break
                }
                return Unmanaged.passUnretained(event)
            }

            eventTap = CGEvent.tapCreate(
                tap: .cgSessionEventTap,
                place: .headInsertEventTap,
                options: .defaultTap,
                eventsOfInterest: mask,
                callback: callback,
                userInfo: Unmanaged.passUnretained(self).toOpaque()
            )

            guard let eventTap else {
                return false
            }
            runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, eventTap, 0)
            CFRunLoopAddSource(CFRunLoopGetMain(), runLoopSource, .commonModes)
            CGEvent.tapEnable(tap: eventTap, enable: true)
        }

        localKeyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) {
            [weak self] event in
            guard let self else {
                return event
            }
            let relevantModifiers = event.modifierFlags.intersection([
                .control,
                .option,
                .command,
                .shift,
            ])
            let isShortcut =
                event.keyCode == 15 &&
                relevantModifiers == [.control, .option]
            if isShortcut {
                self.triggerKeyboardShortcut(source: "app-local", isRepeat: event.isARepeat)
                return nil
            }
            if event.keyCode == 53, relevantModifiers.isEmpty, self.receiveCancel() {
                return nil
            }
            return event
        }
        localPointerMonitor = NSEvent.addLocalMonitorForEvents(matching: .leftMouseDown) {
            [weak self] event in
            if let point = self?.quartzPoint(for: event),
               self?.receivePointerDown(point: point) == true
            {
                return nil
            }
            return event
        }
        localPointerMoveMonitor = NSEvent.addLocalMonitorForEvents(matching: .mouseMoved) {
            [weak self] event in
            guard let self, self.shouldTrackPointerMoves(),
                  let point = self.quartzPoint(for: event)
            else {
                return event
            }
            self.receivePointerMove(point: point)
            return event
        }
        return true
    }

    private func quartzPoint(for event: NSEvent) -> CGPoint? {
        let appKitPoint: CGPoint
        if let window = event.window {
            appKitPoint = window.convertPoint(toScreen: event.locationInWindow)
        } else {
            appKitPoint = NSEvent.mouseLocation
        }
        return ScreenCoordinates.quartzPoint(fromAppKit: appKitPoint)
    }

    private func receivePointerMove(point: CGPoint) {
        onPointerMove(point)
    }

    private func receivePointerDown(point: CGPoint) -> Bool {
        if debugEvents {
            fputs(
                "pointer-down x=\(Int(point.x)) y=\(Int(point.y))\n",
                stderr
            )
            fflush(stderr)
        }
        return onPointerDown(point)
    }

    private func receiveCancel() -> Bool {
        let consumed = onCancel()
        if debugEvents, consumed {
            fputs("keyboard-cancel accepted escape\n", stderr)
            fflush(stderr)
        }
        return consumed
    }

    private func receiveKeyDown(
        keyCode: Int64,
        flags: CGEventFlags,
        isRepeat: Bool
    ) {
        let isShortcut = isKeyboardShortcut(keyCode: keyCode, flags: flags)

        if debugEvents, isShortcut {
            fputs("keyboard-shortcut source=event-tap control-option-r\n", stderr)
        }

        if isShortcut {
            triggerKeyboardShortcut(source: "event-tap", isRepeat: isRepeat)
        }
    }

    private func isKeyboardShortcut(
        keyCode: Int64,
        flags: CGEventFlags
    ) -> Bool {
        let shortcutModifiers: CGEventFlags = [.maskControl, .maskAlternate]
        let relevantModifiers = flags.intersection([
            .maskControl,
            .maskAlternate,
            .maskCommand,
            .maskShift,
        ])
        return keyCode == 15 && relevantModifiers == shortcutModifiers
    }

    private func isCancelKey(
        keyCode: Int64,
        flags: CGEventFlags
    ) -> Bool {
        let relevantModifiers = flags.intersection([
            .maskControl,
            .maskAlternate,
            .maskCommand,
            .maskShift,
        ])
        return keyCode == 53 && relevantModifiers.isEmpty
    }

    private func triggerKeyboardShortcut(source: String, isRepeat: Bool) {
        guard !isRepeat else {
            return
        }

        let now = ProcessInfo.processInfo.systemUptime
        guard now - previousShortcutTime > 0.15 else {
            return
        }
        previousShortcutTime = now

        if debugEvents {
            fputs("keyboard-shortcut accepted source=\(source)\n", stderr)
            fflush(stderr)
        }
        onKeyboardShortcut()
    }

    deinit {
        if let localKeyMonitor {
            NSEvent.removeMonitor(localKeyMonitor)
        }
        if let localPointerMonitor {
            NSEvent.removeMonitor(localPointerMonitor)
        }
        if let localPointerMoveMonitor {
            NSEvent.removeMonitor(localPointerMoveMonitor)
        }
    }
}

private final class AppDelegate: NSObject, NSApplicationDelegate {
    private let options: Options
    private let resolver = TargetResolver()
    private var overlay: OverlayController?
    private var monitor: InputMonitor?
    private var statusItem: NSStatusItem?
    private var fixtureWindow: NSWindow?
    private weak var fixtureTextView: NSTextView?
    private weak var fixtureButton: NSButton?
    private var fixtureButtonActivationCount = 0
    private var isPickingElement = false
    private var lastElementResolutionTime: TimeInterval = 0

    init(options: Options) {
        self.options = options
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        let overlay = OverlayController()
        self.overlay = overlay
        configureStatusItem()

        if options.demo {
            showDemo(using: overlay)
            return
        }
        if options.fixture {
            showFixture()
        }

        let hasAccessibility = accessibilityIsTrusted(
            prompt: options.requestPermission
        )
        let hasInputMonitoring = inputMonitoringIsTrusted(
            prompt: options.requestPermission
        )
        let hasGlobalPermissions = hasAccessibility && hasInputMonitoring
        guard hasGlobalPermissions || options.fixture else {
            fputs(
                """
                Highlight & React needs macOS Accessibility and Input Monitoring access.
                Build the app bundle, then enable it in:
                System Settings > Privacy & Security > Accessibility
                System Settings > Privacy & Security > Input Monitoring
                Re-run with --request-permission to open the system prompt.

                """,
                stderr
            )
            NSApp.terminate(nil)
            return
        }
        if !hasGlobalPermissions {
            print(
                "Fixture running in local-only mode. Global app targeting " +
                    "still requires Accessibility and Input Monitoring permission."
            )
            fflush(stdout)
        }

        let monitor = InputMonitor(
            debugEvents: options.debugAccessibility,
            shouldTrackPointerMoves: { [weak self] in
                self?.isPickingElement == true
            },
            onPointerMove: { [weak self] point in
                self?.handlePointerMove(point)
            },
            onPointerDown: { [weak self] point in
                guard let self else {
                    return false
                }
                if self.isPickingElement {
                    return self.lockElement(at: point)
                }
                if self.overlay?.dismissIfPointerIsOutside(quartzPoint: point) == true {
                    print("Highlight & React overlay dismissed by outside click.")
                    fflush(stdout)
                }
                return false
            },
            onCancel: { [weak self] in
                self?.cancelCurrentInteraction(reason: "Escape") ?? false
            },
            onKeyboardShortcut: { [weak self] in
                self?.handleKeyboardShortcut()
            }
        )
        self.monitor = monitor

        guard monitor.start(globalEvents: hasGlobalPermissions) else {
            fputs(
                """
                Could not install the input event tap.
                Enable Highlight & React in:
                System Settings > Privacy & Security > Input Monitoring

                """,
                stderr
            )
            NSApp.terminate(nil)
            return
        }

        let listeningScope = hasGlobalPermissions ? "globally" : "in the fixture"
        print(
            "Highlight & React is listening \(listeningScope). Select text and press " +
                "Control-Option-R, or press it with no selection to pick an element."
        )
        fflush(stdout)
        if options.fixtureAutoTest {
            Timer.scheduledTimer(withTimeInterval: 0.25, repeats: false) {
                [weak self] _ in
                self?.runFixtureElementAutoTest()
            }
        }
    }

    private func handleKeyboardShortcut() {
        if cancelCurrentInteraction(reason: "Control-Option-R") {
            return
        }

        if let target = fixtureSelectionTarget() ?? resolver.resolveSelection(
            debugAccessibility: options.debugAccessibility
        ) {
            showLockedTarget(target)
            return
        }

        isPickingElement = true
        lastElementResolutionTime = 0
        print(
            "Element picker active. Hover an interface element and click to " +
                "react; press Escape to cancel."
        )
        fflush(stdout)
        if let point = ScreenCoordinates.quartzPoint(
            fromAppKit: NSEvent.mouseLocation
        ) {
            handlePointerMove(point)
        }
    }

    private func handlePointerMove(_ point: CGPoint) {
        guard isPickingElement else {
            return
        }
        let now = ProcessInfo.processInfo.systemUptime
        guard now - lastElementResolutionTime >= 0.04 else {
            return
        }
        lastElementResolutionTime = now

        guard let target = resolveElement(at: point) else {
            overlay?.hidePreview()
            return
        }
        _ = overlay?.showPreview(target: target)
    }

    private func lockElement(at point: CGPoint) -> Bool {
        guard isPickingElement else {
            return false
        }
        guard let target = resolveElement(at: point) else {
            overlay?.hidePreview()
            return true
        }

        isPickingElement = false
        showLockedTarget(target)
        return true
    }

    private func resolveElement(at point: CGPoint) -> HighlightTarget? {
        if let target = fixtureElementTarget(at: point) {
            return target
        }
        return resolver.resolveElement(
            at: point,
            excludingProcessIdentifier: options.fixture
                ? nil
                : ProcessInfo.processInfo.processIdentifier,
            debugAccessibility: options.debugAccessibility
        )
    }

    private func fixtureElementTarget(at quartzPoint: CGPoint) -> HighlightTarget? {
        guard options.fixture,
              let window = fixtureWindow,
              let contentView = window.contentView,
              let appKitPoint = ScreenCoordinates.appKitPoint(fromQuartz: quartzPoint)
        else {
            return nil
        }
        let windowPoint = window.convertPoint(fromScreen: appKitPoint)
        let contentPoint = contentView.convert(windowPoint, from: nil)
        guard let view = contentView.hitTest(contentPoint),
              view !== contentView,
              !(view is NSTextView)
        else {
            return nil
        }

        let boundsInWindow = view.convert(view.bounds, to: nil)
        let appKitFrame = window.convertToScreen(boundsInWindow)
        guard let quartzFrame = ScreenCoordinates.quartzRect(fromAppKit: appKitFrame),
              quartzFrame.width >= 4,
              quartzFrame.height >= 4
        else {
            return nil
        }
        let text: String
        if let button = view as? NSButton {
            text = button.title
        } else {
            text = view.accessibilityLabel() ?? String(describing: type(of: view))
        }
        return HighlightTarget(
            quartzFrame: quartzFrame,
            kind: .element,
            role: view.accessibilityRole()?.rawValue ?? "AXUnknown",
            text: text,
            applicationName: "Highlight & React"
        )
    }

    @discardableResult
    private func cancelCurrentInteraction(reason: String) -> Bool {
        guard isPickingElement
            || overlay?.hasLockedTarget == true
            || overlay?.hasPreview == true
        else {
            return false
        }
        isPickingElement = false
        overlay?.hide()
        print("Highlight & React interaction hidden by \(reason).")
        fflush(stdout)
        return true
    }

    private func showLockedTarget(_ target: HighlightTarget) {
        if overlay?.show(target: target) == true {
            print(
                "\(target.kind.rawValue.capitalized) target shown for " +
                    "\(target.applicationName): " +
                    "\(target.text.prefix(120))"
            )
            fflush(stdout)
        } else {
            fputs("Could not map the selected bounds to a display.\n", stderr)
            fflush(stderr)
        }
    }

    private func fixtureSelectionTarget() -> HighlightTarget? {
        guard options.fixture,
              let textView = fixtureTextView,
              textView.selectedRange().length > 0
        else {
            return nil
        }

        let range = textView.selectedRange()
        let text = (textView.string as NSString).substring(with: range)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        var actualRange = NSRange()
        let appKitFrame = textView.firstRect(
            forCharacterRange: range,
            actualRange: &actualRange
        )
        guard !text.isEmpty,
              let quartzFrame = ScreenCoordinates.quartzRect(
                fromAppKit: appKitFrame
              )
        else {
            return nil
        }

        if options.debugAccessibility {
            fputs(
                "fixture-selection frame=(\(Int(quartzFrame.minX))," +
                    "\(Int(quartzFrame.minY)),\(Int(quartzFrame.width))," +
                    "\(Int(quartzFrame.height))) text=\(text.prefix(120))\n",
                stderr
            )
            fflush(stderr)
        }
        return HighlightTarget(
            quartzFrame: quartzFrame,
            kind: .text,
            role: "AXTextArea",
            text: String(text.prefix(280)),
            applicationName: "Highlight & React"
        )
    }

    private func showDemo(using overlay: OverlayController) {
        guard let screen = NSScreen.main,
              let displayID = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")]
                as? CGDirectDisplayID
        else {
            NSApp.terminate(nil)
            return
        }

        let quartzScreen = CGDisplayBounds(displayID)
        let target = HighlightTarget(
            quartzFrame: CGRect(
                x: quartzScreen.midX - 210,
                y: quartzScreen.midY - 55,
                width: 420,
                height: 110
            ),
            kind: .element,
            role: "AXGroup",
            text: "Demo selection: click elsewhere to dismiss this overlay.",
            applicationName: "Highlight & React Demo"
        )
        overlay.show(target: target)
        print("Showing permission-free overlay demo.")
        fflush(stdout)

        if let seconds = options.demoSeconds {
            Timer.scheduledTimer(withTimeInterval: seconds, repeats: false) { _ in
                NSApp.terminate(nil)
            }
        }
    }

    private func showFixture() {
        NSApp.setActivationPolicy(.regular)
        let window = NSWindow(
            contentRect: CGRect(x: 0, y: 0, width: 680, height: 340),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Highlight & React Keyboard Fixture"
        window.acceptsMouseMovedEvents = true
        window.center()

        let contentBounds = window.contentView?.bounds ?? .zero
        let container = NSView(frame: contentBounds)
        container.autoresizingMask = [.width, .height]

        let scrollView = NSScrollView(
            frame: CGRect(
                x: 0,
                y: 66,
                width: contentBounds.width,
                height: contentBounds.height - 66
            )
        )
        scrollView.autoresizingMask = [.width, .height]
        scrollView.hasVerticalScroller = true
        scrollView.drawsBackground = true

        let textView = NSTextView(frame: scrollView.bounds)
        textView.isEditable = true
        textView.isSelectable = true
        textView.isRichText = false
        textView.font = .systemFont(ofSize: 21)
        textView.textContainerInset = CGSize(width: 28, height: 28)
        textView.string =
            """
            Highlight & React keyboard fixture

            Select this sentence, then press Control–Option–R.

            Text mode: a yellow outline hugs only the selected text.

            Element mode: clear the selection, press Control–Option–R, hover the button below, and click it. A dashed blue preview should lock into a solid blue outline with the reaction bar. The selection click must not activate the button.
            """
        textView.setAccessibilityIdentifier("KeyboardFixtureText")
        fixtureTextView = textView
        scrollView.documentView = textView

        let button = NSButton(
            title: "Inspectable fixture button",
            target: self,
            action: #selector(fixtureButtonActivated)
        )
        button.frame = CGRect(x: 28, y: 15, width: 240, height: 36)
        button.bezelStyle = .rounded
        button.setAccessibilityIdentifier("InspectableFixtureButton")
        fixtureButton = button
        container.addSubview(scrollView)
        container.addSubview(button)
        window.contentView = container

        fixtureWindow = window
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func runFixtureElementAutoTest() {
        guard let window = fixtureWindow,
              let button = fixtureButton
        else {
            fputs("fixture-auto-test failed: fixture controls unavailable\n", stderr)
            exit(1)
        }
        fixtureTextView?.setSelectedRange(NSRange(location: 0, length: 0))
        handleKeyboardShortcut()

        let boundsInWindow = button.convert(button.bounds, to: nil)
        let appKitFrame = window.convertToScreen(boundsInWindow)
        guard let quartzFrame = ScreenCoordinates.quartzRect(fromAppKit: appKitFrame) else {
            fputs("fixture-auto-test failed: coordinate conversion\n", stderr)
            exit(1)
        }
        let point = CGPoint(x: quartzFrame.midX, y: quartzFrame.midY)
        lastElementResolutionTime = 0
        handlePointerMove(point)
        let previewed = overlay?.hasPreview == true
        let consumed = lockElement(at: point)
        let passed = previewed
            && consumed
            && overlay?.hasLockedTarget == true
            && fixtureButtonActivationCount == 0
        guard passed else {
            fputs(
                "fixture-auto-test failed: previewed=\(previewed) " +
                    "consumed=\(consumed) " +
                    "locked=\(overlay?.hasLockedTarget == true) " +
                    "activations=\(fixtureButtonActivationCount)\n",
                stderr
            )
            exit(1)
        }

        print(
            "fixture-auto-test passed: element preview resolved, click was " +
                "consumed, target locked, underlying button stayed inactive."
        )
        fflush(stdout)
        NSApp.terminate(nil)
    }

    @objc private func fixtureButtonActivated() {
        fixtureButtonActivationCount += 1
        print(
            "Fixture button activated count=\(fixtureButtonActivationCount). " +
                "This should remain zero when the element picker locks it."
        )
        fflush(stdout)
    }

    private func configureStatusItem() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        item.button?.title = "✦"
        item.button?.toolTip = "Highlight & React"

        let menu = NSMenu()
        let shortcutItem = NSMenuItem(
            title: "Shortcut: ⌃⌥R",
            action: nil,
            keyEquivalent: ""
        )
        shortcutItem.isEnabled = false
        menu.addItem(shortcutItem)
        menu.addItem(.separator())
        menu.addItem(
            withTitle: "Show Demo Overlay",
            action: #selector(showDemoFromMenu),
            keyEquivalent: ""
        ).target = self
        menu.addItem(
            withTitle: "Hide Overlay",
            action: #selector(hideOverlay),
            keyEquivalent: ""
        ).target = self
        menu.addItem(.separator())
        menu.addItem(
            withTitle: "Quit Highlight & React",
            action: #selector(quit),
            keyEquivalent: "q"
        ).target = self
        item.menu = menu
        statusItem = item
    }

    @objc private func showDemoFromMenu() {
        guard let overlay else {
            return
        }
        showDemo(using: overlay)
    }

    @objc private func hideOverlay() {
        isPickingElement = false
        overlay?.hide()
    }

    @objc private func quit() {
        NSApp.terminate(nil)
    }

    private func accessibilityIsTrusted(prompt: Bool) -> Bool {
        guard prompt else {
            return AXIsProcessTrusted()
        }
        let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
        return AXIsProcessTrustedWithOptions([key: true] as CFDictionary)
    }

    private func inputMonitoringIsTrusted(prompt: Bool) -> Bool {
        prompt ? CGRequestListenEventAccess() : CGPreflightListenEventAccess()
    }
}

private let options = Options.parse(CommandLine.arguments)
private let application = NSApplication.shared
private let delegate = AppDelegate(options: options)
application.delegate = delegate
application.run()
