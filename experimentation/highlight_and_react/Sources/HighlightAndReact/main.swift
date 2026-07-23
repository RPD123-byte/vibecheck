import AppKit
import ApplicationServices
import CoreGraphics
import Foundation
import HighlightCore

private struct Options {
    var demo = false
    var demoSeconds: TimeInterval?
    var debugCandidates = false
    var fixture = false
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
            case "--debug-candidates":
                options.debugCandidates = true
            case "--fixture":
                options.fixture = true
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
                      --debug-candidates        Log the Accessibility candidates and scores
                      --fixture                 Open a selectable keyboard-shortcut test window
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
    let quartzFrame: CGRect
    let role: String
    let text: String
    let applicationName: String
}

private struct Candidate {
    let element: AXUIElement
    let frame: CGRect
    let role: String
    let text: String
    let depth: Int
    let score: Int
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

    static func frame(from element: AXUIElement) -> CGRect? {
        if let value = copy("AXFrame", from: element),
           let frame = rect(from: value)
        {
            return frame
        }

        guard
            let positionValue = copy(kAXPositionAttribute, from: element),
            let sizeValue = copy(kAXSizeAttribute, from: element),
            CFGetTypeID(positionValue) == AXValueGetTypeID(),
            CFGetTypeID(sizeValue) == AXValueGetTypeID()
        else {
            return nil
        }

        var position = CGPoint.zero
        var size = CGSize.zero
        let axPosition = unsafeBitCast(positionValue, to: AXValue.self)
        let axSize = unsafeBitCast(sizeValue, to: AXValue.self)
        guard
            AXValueGetValue(axPosition, .cgPoint, &position),
            AXValueGetValue(axSize, .cgSize, &size)
        else {
            return nil
        }
        return CGRect(origin: position, size: size)
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

    static func bestText(from element: AXUIElement) -> String {
        let attributes = [
            kAXValueAttribute,
            kAXTitleAttribute,
            kAXDescriptionAttribute,
            kAXHelpAttribute,
        ]

        for attribute in attributes {
            if let value = string(attribute, from: element)?
                .trimmingCharacters(in: .whitespacesAndNewlines),
               !value.isEmpty
            {
                return String(value.prefix(280))
            }
        }
        return ""
    }
}

private final class TargetResolver {
    private let systemWide = AXUIElementCreateSystemWide()

    func resolveSelection(debugCandidates: Bool) -> HighlightTarget? {
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

                logSelectionElement(element, depth: depth, enabled: debugCandidates)
                if let target = selection(from: element) {
                    logResolvedSelection(
                        target,
                        source: "focused-chain depth=\(depth)",
                        enabled: debugCandidates
                    )
                    return target
                }
                current = AccessibilityValue.parent(of: element)
            }
        } else {
            debugSelection("No focused Accessibility element.", enabled: debugCandidates)
        }

        if let target = searchActiveWindowForSelection(
            debugCandidates: debugCandidates
        ) {
            return target
        }

        debugSelection(
            "No non-empty Accessibility selection with usable bounds.",
            enabled: debugCandidates
        )
        return nil
    }

    private func selection(from element: AXUIElement) -> HighlightTarget? {
        rangeSelection(from: element) ?? markerSelection(from: element)
    }

    private func searchActiveWindowForSelection(
        debugCandidates: Bool
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
                    enabled: debugCandidates
                )
                return target
            }
            queue.append(contentsOf: AccessibilityValue.children(of: element))
        }

        debugSelection(
            "Active-window selection search inspected \(min(index, maximumElements)) elements.",
            enabled: debugCandidates
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

    func resolve(at point: CGPoint, debugCandidates: Bool) -> HighlightTarget? {
        var hitElement: AXUIElement?
        guard AXUIElementCopyElementAtPosition(
            systemWide,
            Float(point.x),
            Float(point.y),
            &hitElement
        ) == .success, let hitElement else {
            return nil
        }

        var candidates: [Candidate] = []
        var current: AXUIElement? = hitElement

        for depth in 0..<9 {
            guard let element = current else {
                break
            }
            if let candidate = candidate(for: element, point: point, depth: depth) {
                candidates.append(candidate)
            }
            current = AccessibilityValue.parent(of: element)
        }

        if debugCandidates {
            log(candidates: candidates)
        }

        guard let best = candidates.max(by: { $0.score < $1.score }) else {
            return nil
        }

        var pid: pid_t = 0
        AXUIElementGetPid(best.element, &pid)
        let appName = NSRunningApplication(processIdentifier: pid)?
            .localizedName ?? "Unknown app"

        return HighlightTarget(
            quartzFrame: best.frame,
            role: best.role,
            text: best.text,
            applicationName: appName
        )
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

    private func log(candidates: [Candidate]) {
        for candidate in candidates.sorted(by: { $0.score > $1.score }) {
            let frame = candidate.frame
            let preview = candidate.text
                .replacingOccurrences(of: "\n", with: " ")
                .prefix(90)
            fputs(
                "candidate score=\(candidate.score) depth=\(candidate.depth) " +
                    "role=\(candidate.role) " +
                    "frame=(\(Int(frame.minX)),\(Int(frame.minY))," +
                    "\(Int(frame.width)),\(Int(frame.height))) " +
                    "text=\(preview)\n",
                stderr
            )
        }
        fflush(stderr)
    }

    private func candidate(
        for element: AXUIElement,
        point: CGPoint,
        depth: Int
    ) -> Candidate? {
        guard let frame = AccessibilityValue.frame(from: element),
              frame.width >= 16,
              frame.height >= 12,
              frame.width <= 1_600,
              frame.height <= 500,
              frame.insetBy(dx: -2, dy: -2).contains(point)
        else {
            return nil
        }

        let role = AccessibilityValue.string(kAXRoleAttribute, from: element) ?? "AXUnknown"
        guard role != kAXWindowRole, role != kAXApplicationRole else {
            return nil
        }

        let text = AccessibilityValue.bestText(from: element)
        var score = max(0, 10 - depth)

        switch role {
        case kAXStaticTextRole:
            score += 26
        case kAXTextAreaRole:
            score += 24
        case kAXGroupRole:
            score += 24
        case kAXButtonRole:
            score += 8
        default:
            score += 4
        }

        if !text.isEmpty {
            score += 18
        }
        if frame.width >= 140 {
            score += 10
        }
        if (28...240).contains(frame.height) {
            score += 12
        }
        if role == kAXGroupRole,
           (200...1_200).contains(frame.width),
           (32...280).contains(frame.height)
        {
            score += 24
        }
        if frame.width > 1_200 || frame.height > 350 {
            score -= 20
        }

        return Candidate(
            element: element,
            frame: frame,
            role: role,
            text: text,
            depth: depth,
            score: score
        )
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
    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        let path = NSBezierPath(
            roundedRect: bounds.insetBy(dx: 2, dy: 2),
            xRadius: 10,
            yRadius: 10
        )
        NSColor.systemYellow.withAlphaComponent(0.13).setFill()
        path.fill()
        NSColor.systemYellow.withAlphaComponent(0.92).setStroke()
        path.lineWidth = 2.5
        path.stroke()
    }
}

private final class OverlayController: NSObject {
    private let highlightPanel: NSPanel
    private let reactionPanel: NSPanel
    private let stackView: NSStackView
    private var currentTarget: HighlightTarget?
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

    @discardableResult
    func show(target: HighlightTarget) -> Bool {
        guard let (targetFrame, screen) = ScreenCoordinates.appKitRect(
            fromQuartz: target.quartzFrame
        ) else {
            return false
        }

        currentTarget = target
        let highlightFrame = OverlayLayout.highlightFrame(
            target: targetFrame,
            visibleScreen: screen.visibleFrame
        )
        let barFrame = OverlayLayout.reactionBarFrame(
            target: targetFrame,
            visibleScreen: screen.visibleFrame,
            barSize: CGSize(width: 292, height: 48)
        )

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
        highlightPanel.contentView = HighlightView(frame: .zero)

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
    private let onDoubleClick: (CGPoint) -> Void
    private let onKeyboardShortcut: () -> Void
    private let debugEvents: Bool
    private var previousClick: (time: TimeInterval, point: CGPoint)?
    private var previousShortcutTime: TimeInterval = 0

    init(
        debugEvents: Bool,
        onDoubleClick: @escaping (CGPoint) -> Void,
        onKeyboardShortcut: @escaping () -> Void
    ) {
        self.debugEvents = debugEvents
        self.onDoubleClick = onDoubleClick
        self.onKeyboardShortcut = onKeyboardShortcut
    }

    func start() -> Bool {
        let mask =
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
            case .leftMouseDown:
                let clickCount = event.getIntegerValueField(.mouseEventClickState)
                let point = event.location
                DispatchQueue.main.async {
                    monitor.receiveMouseDown(point: point, clickCount: clickCount)
                }
            case .keyDown:
                let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
                let isRepeat = event.getIntegerValueField(.keyboardEventAutorepeat) != 0
                let flags = event.flags
                let isShortcut = monitor.isKeyboardShortcut(
                    keyCode: keyCode,
                    flags: flags
                )
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
            guard isShortcut else {
                return event
            }

            self.triggerKeyboardShortcut(source: "app-local", isRepeat: event.isARepeat)
            return nil
        }
        return true
    }

    private func receiveMouseDown(point: CGPoint, clickCount: Int64) {
        let now = ProcessInfo.processInfo.systemUptime
        let isTimingFallbackDoubleClick: Bool

        if let previousClick {
            let elapsed = now - previousClick.time
            let distance = hypot(
                point.x - previousClick.point.x,
                point.y - previousClick.point.y
            )
            isTimingFallbackDoubleClick =
                elapsed <= NSEvent.doubleClickInterval && distance <= 6
        } else {
            isTimingFallbackDoubleClick = false
        }

        if debugEvents {
            fputs(
                "mouse-down count=\(clickCount) x=\(Int(point.x)) y=\(Int(point.y)) " +
                    "fallback-double=\(isTimingFallbackDoubleClick)\n",
                stderr
            )
            fflush(stderr)
        }

        if clickCount >= 2 || isTimingFallbackDoubleClick {
            previousClick = nil
            onDoubleClick(point)
        } else {
            previousClick = (now, point)
        }
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
    }
}

private final class AppDelegate: NSObject, NSApplicationDelegate {
    private let options: Options
    private let resolver = TargetResolver()
    private var overlay: OverlayController?
    private var monitor: InputMonitor?
    private var statusItem: NSStatusItem?
    private var fixtureWindow: NSWindow?

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

        guard accessibilityIsTrusted(prompt: options.requestPermission) else {
            fputs(
                """
                Highlight & React needs macOS Accessibility access.
                Build the app bundle, then enable it in:
                System Settings > Privacy & Security > Accessibility
                Re-run with --request-permission to open the system prompt.

                """,
                stderr
            )
            NSApp.terminate(nil)
            return
        }

        let monitor = InputMonitor(
            debugEvents: options.debugCandidates,
            onDoubleClick: { [weak self] point in
                guard
                    let self,
                    let target = self.resolver.resolve(
                        at: point,
                        debugCandidates: self.options.debugCandidates
                    )
                else {
                    return
                }
                self.overlay?.show(target: target)
            },
            onKeyboardShortcut: { [weak self] in
                self?.showOverlayForSelection()
            }
        )
        self.monitor = monitor

        guard monitor.start() else {
            fputs(
                """
                Could not install the read-only mouse event tap.
                Enable Highlight & React in:
                System Settings > Privacy & Security > Input Monitoring

                """,
                stderr
            )
            NSApp.terminate(nil)
            return
        }

        print(
            "Highlight & React is listening. Select text and press Control-Option-R, " +
                "or double-click accessible content."
        )
        fflush(stdout)
    }

    private func showOverlayForSelection() {
        guard let target = resolver.resolveSelection(
            debugCandidates: options.debugCandidates
        ) else {
            fputs(
                "Control-Option-R: no accessible text selection found. " +
                    "Select text first and try again.\n",
                stderr
            )
            fflush(stderr)
            return
        }
        if overlay?.show(target: target) == true {
            print(
                "Selection overlay shown for \(target.applicationName): " +
                    "\(target.text.prefix(120))"
            )
            fflush(stdout)
        } else {
            fputs("Could not map the selected bounds to a display.\n", stderr)
            fflush(stderr)
        }
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
            role: "AXGroup",
            text: "Demo message: double-click a Codex response to place this overlay.",
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
        window.center()

        let scrollView = NSScrollView(frame: window.contentView?.bounds ?? .zero)
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

            Expected result: a yellow outline hugs the selected text and the emoji reaction bar appears above it. The shortcut is global, so the same interaction can be tried in Codex without restarting or modifying Codex.
            """
        textView.setAccessibilityIdentifier("KeyboardFixtureText")
        scrollView.documentView = textView
        window.contentView = scrollView

        fixtureWindow = window
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
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
}

private let options = Options.parse(CommandLine.arguments)
private let application = NSApplication.shared
private let delegate = AppDelegate(options: options)
application.delegate = delegate
application.run()
