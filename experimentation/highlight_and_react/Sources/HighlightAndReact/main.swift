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
    var legacyGlobal = false
    var pasteAdapter = false
    var pasteNow = false
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
            case "--legacy-global":
                options.legacyGlobal = true
            case "--paste-adapter":
                options.pasteAdapter = true
            case "--paste-now":
                options.pasteNow = true
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
                      --legacy-global           Run the different legacy native shortcut path
                      --paste-adapter           Expand marked Command-V context bundles
                      --paste-now               Deliver clipboard context once and exit
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
    private var currentTargetFrame: CGRect?
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

    var isVisible: Bool {
        currentTarget != nil
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
        currentTargetFrame = nil
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

private enum PasteSequenceError: LocalizedError {
    case contextMissing
    case eventCreationFailed
    case pasteboardWriteFailed

    var errorDescription: String? {
        switch self {
        case .contextMissing:
            "clipboard must contain both plain text and a PNG image"
        case .eventCreationFailed:
            "could not create a native Command-V keyboard event"
        case .pasteboardWriteFailed:
            "macOS rejected a temporary pasteboard payload"
        }
    }
}

private struct PasteSequencePayload {
    let bundle: ClipboardContextBundle

    static func read(from pasteboard: NSPasteboard = .general) throws
        -> PasteSequencePayload
    {
        if let bundle = ClipboardContextPasteboard.read(from: pasteboard) {
            return PasteSequencePayload(bundle: bundle)
        }
        throw PasteSequenceError.contextMissing
    }

    static func isMarked(in pasteboard: NSPasteboard = .general) -> Bool {
        ClipboardContextPasteboard.isMarked(pasteboard)
    }

    func restore(
        consumed: Bool,
        to pasteboard: NSPasteboard = .general
    ) throws {
        let restoredBundle = consumed ? bundle.markingConsumed() : bundle
        try ClipboardContextPasteboard.write(restoredBundle, to: pasteboard)
    }
}

private final class PasteSequenceAdapter {
    private let delay: TimeInterval
    private let lock = NSLock()
    private var deliveryInProgress = false

    init(delayMilliseconds: Int = 450) {
        delay = Double(delayMilliseconds) / 1_000
    }

    func deliverCurrentClipboard() {
        lock.lock()
        guard !deliveryInProgress else {
            lock.unlock()
            return
        }
        deliveryInProgress = true
        lock.unlock()

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            defer {
                self?.lock.lock()
                self?.deliveryInProgress = false
                self?.lock.unlock()
            }
            do {
                try self?.deliverCurrentClipboardSynchronously()
                print(
                    "[highlight-paste-adapter] pasted clipboard bundle; " +
                        "clipboard bundle marked consumed and restored"
                )
                fflush(stdout)
            } catch {
                fputs(
                    "[highlight-paste-adapter] \(error.localizedDescription)\n",
                    stderr
                )
                fflush(stderr)
            }
        }
    }

    func deliverCurrentClipboardSynchronously() throws {
        try deliver(PasteSequencePayload.read())
    }

    private func deliver(_ payload: PasteSequencePayload) throws {
        let focusedElement = currentFocusedElement()
        let targetApplication =
            NSWorkspace.shared.frontmostApplication?.bundleIdentifier
            ?? "unknown"
        print(
            "[highlight-paste-adapter] target=\(targetApplication) " +
                "contexts=\(payload.bundle.entries.count)"
        )
        fflush(stdout)
        do {
            for (index, entry) in payload.bundle.entries.enumerated() {
                try writeText(entry.text)
                try postPasteShortcut()
                print(
                    "[highlight-paste-adapter] context=\(index + 1) " +
                        "emitted text Command-V"
                )
                fflush(stdout)
                Thread.sleep(forTimeInterval: delay)

                restoreFocus(focusedElement)
                try writePNG(entry.png)
                try postPasteShortcut()
                print(
                    "[highlight-paste-adapter] context=\(index + 1) " +
                        "emitted image Command-V"
                )
                fflush(stdout)
                Thread.sleep(forTimeInterval: delay)
                restoreFocus(focusedElement)
            }
            try payload.restore(consumed: true)
        } catch {
            try? payload.restore(consumed: false)
            throw error
        }
    }

    private func restoreFocus(_ element: AXUIElement?) {
        guard let element else {
            return
        }
        AXUIElementSetAttributeValue(
            element,
            kAXFocusedAttribute as CFString,
            kCFBooleanTrue
        )
    }

    private func currentFocusedElement() -> AXUIElement? {
        let systemWide = AXUIElementCreateSystemWide()
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(
            systemWide,
            kAXFocusedUIElementAttribute as CFString,
            &value
        ) == .success, let value
        else {
            return nil
        }
        return unsafeBitCast(value, to: AXUIElement.self)
    }

    private func writeText(_ text: String) throws {
        let item = NSPasteboardItem()
        item.setString(text, forType: .string)
        NSPasteboard.general.clearContents()
        guard NSPasteboard.general.writeObjects([item]) else {
            throw PasteSequenceError.pasteboardWriteFailed
        }
    }

    private func writePNG(_ png: Data) throws {
        let item = NSPasteboardItem()
        item.setData(png, forType: .png)
        NSPasteboard.general.clearContents()
        guard NSPasteboard.general.writeObjects([item]) else {
            throw PasteSequenceError.pasteboardWriteFailed
        }
    }

    private func postPasteShortcut() throws {
        guard let source = CGEventSource(stateID: .hidSystemState),
              let keyDown = CGEvent(
                  keyboardEventSource: source,
                  virtualKey: 9,
                  keyDown: true
              ),
              let keyUp = CGEvent(
                  keyboardEventSource: source,
                  virtualKey: 9,
                  keyDown: false
              )
        else {
            throw PasteSequenceError.eventCreationFailed
        }
        keyDown.flags = .maskCommand
        keyUp.flags = .maskCommand
        keyDown.post(tap: .cghidEventTap)
        keyUp.post(tap: .cghidEventTap)
    }
}

private final class InputMonitor {
    private var eventTap: CFMachPort?
    private var runLoopSource: CFRunLoopSource?
    private var localKeyMonitor: Any?
    private var localPointerMonitor: Any?
    private let onPointerDown: (CGPoint) -> Void
    private let onKeyboardShortcut: () -> Void
    private let onPasteShortcut: () -> Void
    private let highlightShortcutEnabled: Bool
    private let pasteShortcutEnabled: Bool
    private let debugEvents: Bool
    private var previousShortcutTimes: [Int64: TimeInterval] = [:]

    init(
        debugEvents: Bool,
        highlightShortcutEnabled: Bool,
        pasteShortcutEnabled: Bool,
        onPointerDown: @escaping (CGPoint) -> Void,
        onKeyboardShortcut: @escaping () -> Void,
        onPasteShortcut: @escaping () -> Void
    ) {
        self.debugEvents = debugEvents
        self.highlightShortcutEnabled = highlightShortcutEnabled
        self.pasteShortcutEnabled = pasteShortcutEnabled
        self.onPointerDown = onPointerDown
        self.onKeyboardShortcut = onKeyboardShortcut
        self.onPasteShortcut = onPasteShortcut
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
                let point = event.location
                DispatchQueue.main.async {
                    monitor.receivePointerDown(point: point)
                }
            case .keyDown:
                let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
                let isRepeat = event.getIntegerValueField(.keyboardEventAutorepeat) != 0
                let flags = event.flags
                let isShortcut = monitor.shortcutKind(
                    keyCode: keyCode,
                    flags: flags
                ) != nil
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
            if event.keyCode == 9,
               relevantModifiers == [.command],
               self.pasteShortcutEnabled,
               PasteSequencePayload.isMarked()
            {
                self.triggerKeyboardShortcut(
                    keyCode: 9,
                    source: "app-local-command-v",
                    isRepeat: event.isARepeat
                )
                return nil
            }
            if event.keyCode == 15,
               relevantModifiers == [.control, .option],
               self.highlightShortcutEnabled
            {
                self.triggerKeyboardShortcut(
                    keyCode: 15,
                    source: "app-local",
                    isRepeat: event.isARepeat
                )
                return nil
            }
            if event.keyCode == 9,
               relevantModifiers == [.control, .option],
               self.pasteShortcutEnabled
            {
                self.triggerKeyboardShortcut(
                    keyCode: 9,
                    source: "app-local",
                    isRepeat: event.isARepeat
                )
                return nil
            }
            return event
        }
        localPointerMonitor = NSEvent.addLocalMonitorForEvents(matching: .leftMouseDown) {
            [weak self] event in
            if let point = ScreenCoordinates.quartzPoint(
                fromAppKit: NSEvent.mouseLocation
            ) {
                self?.receivePointerDown(point: point)
            }
            return event
        }
        return true
    }

    private func receivePointerDown(point: CGPoint) {
        if debugEvents {
            fputs(
                "pointer-down x=\(Int(point.x)) y=\(Int(point.y))\n",
                stderr
            )
            fflush(stderr)
        }
        onPointerDown(point)
    }

    private func receiveKeyDown(
        keyCode: Int64,
        flags: CGEventFlags,
        isRepeat: Bool
    ) {
        let shortcut = shortcutKind(keyCode: keyCode, flags: flags)

        if debugEvents, let shortcut {
            fputs(
                "keyboard-shortcut source=event-tap \(shortcut)\n",
                stderr
            )
        }

        if shortcut != nil {
            triggerKeyboardShortcut(
                keyCode: keyCode,
                source: "event-tap",
                isRepeat: isRepeat
            )
        }
    }

    private func shortcutKind(
        keyCode: Int64,
        flags: CGEventFlags
    ) -> String? {
        let shortcutModifiers: CGEventFlags = [.maskControl, .maskAlternate]
        let relevantModifiers = flags.intersection([
            .maskControl,
            .maskAlternate,
            .maskCommand,
            .maskShift,
        ])
        if keyCode == 9,
           relevantModifiers == .maskCommand,
           pasteShortcutEnabled,
           PasteSequencePayload.isMarked()
        {
            return "command-v-context"
        }
        guard relevantModifiers == shortcutModifiers else {
            return nil
        }
        if keyCode == 15, highlightShortcutEnabled {
            return "control-option-r"
        }
        if keyCode == 9, pasteShortcutEnabled {
            return "control-option-v"
        }
        return nil
    }

    private func triggerKeyboardShortcut(
        keyCode: Int64,
        source: String,
        isRepeat: Bool
    ) {
        guard !isRepeat else {
            return
        }

        let now = ProcessInfo.processInfo.systemUptime
        let previousTime = previousShortcutTimes[keyCode] ?? 0
        guard now - previousTime > 0.15 else {
            return
        }
        previousShortcutTimes[keyCode] = now

        if debugEvents {
            fputs(
                "keyboard-shortcut accepted source=\(source) key=\(keyCode)\n",
                stderr
            )
            fflush(stderr)
        }
        if keyCode == 15 {
            onKeyboardShortcut()
        } else if keyCode == 9 {
            print("[highlight-paste-adapter] intercepted context paste")
            fflush(stdout)
            onPasteShortcut()
        }
    }

    deinit {
        if let localKeyMonitor {
            NSEvent.removeMonitor(localKeyMonitor)
        }
        if let localPointerMonitor {
            NSEvent.removeMonitor(localPointerMonitor)
        }
    }
}

private final class AppDelegate: NSObject, NSApplicationDelegate {
    private let options: Options
    private let resolver = TargetResolver()
    private let pasteSequenceAdapter = PasteSequenceAdapter()
    private var overlay: OverlayController?
    private var monitor: InputMonitor?
    private var statusItem: NSStatusItem?
    private var fixtureWindow: NSWindow?
    private weak var fixtureTextView: NSTextView?

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
        if !options.fixture,
           !options.legacyGlobal,
           !options.pasteAdapter,
           !options.pasteNow
        {
            fputs(
                """
                The native global overlay is legacy research and uses a different UI.
                Use the shared Electron renderer scripts for Highlight & React.
                Pass --legacy-global only when intentionally testing the native prototype.

                """,
                stderr
            )
            NSApp.terminate(nil)
            return
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

        if options.pasteNow {
            DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                do {
                    try self?.pasteSequenceAdapter
                        .deliverCurrentClipboardSynchronously()
                    print(
                        "[highlight-paste-adapter] pasted text and image; " +
                            "clipboard context restored"
                    )
                    fflush(stdout)
                } catch {
                    fputs(
                        "[highlight-paste-adapter] \(error.localizedDescription)\n",
                        stderr
                    )
                    fflush(stderr)
                }
                DispatchQueue.main.async {
                    NSApp.terminate(nil)
                }
            }
            return
        }

        let monitor = InputMonitor(
            debugEvents: options.debugAccessibility,
            highlightShortcutEnabled: options.fixture || options.legacyGlobal,
            pasteShortcutEnabled: true,
            onPointerDown: { [weak self] point in
                guard let self else {
                    return
                }
                if self.overlay?.dismissIfPointerIsOutside(quartzPoint: point) == true {
                    print("Selection overlay dismissed by outside click.")
                    fflush(stdout)
                }
            },
            onKeyboardShortcut: { [weak self] in
                self?.showOverlayForSelection()
            },
            onPasteShortcut: { [weak self] in
                self?.pasteSequenceAdapter.deliverCurrentClipboard()
            }
        )
        self.monitor = monitor

        guard monitor.start() else {
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

        let shortcuts = options.pasteAdapter && !options.fixture && !options.legacyGlobal
            ? "Command-V pastes marked context as text and image."
            : """
              Control-Option-R opens Highlight & React. \
              Command-V pastes marked context as text and image.
              """
        print("Highlight & React is listening. \(shortcuts)")
        fflush(stdout)
    }

    private func showOverlayForSelection() {
        if overlay?.isVisible == true {
            overlay?.hide()
            print("Selection overlay hidden by Control-Option-R.")
            fflush(stdout)
            return
        }

        guard let target = fixtureSelectionTarget() ?? resolver.resolveSelection(
            debugAccessibility: options.debugAccessibility
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
        fixtureTextView = textView
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
