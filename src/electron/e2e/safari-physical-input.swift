import AppKit
import ApplicationServices
import Foundation

guard AXIsProcessTrusted() else {
    fputs("Accessibility permission is required for the Safari acceptance harness.\n", stderr)
    exit(2)
}
guard let safari = NSRunningApplication.runningApplications(
    withBundleIdentifier: "com.apple.Safari"
).first else {
    fputs("Safari is not running.\n", stderr)
    exit(3)
}

let application = AXUIElementCreateApplication(safari.processIdentifier)
let mode = CommandLine.arguments.dropFirst().first ?? "full"
guard
    let window: AXUIElement = attribute(
        application,
        kAXFocusedWindowAttribute as String
    ),
    let webArea = descendant(withRole: "AXWebArea", of: window),
    let position = axPoint(
        attribute(webArea, kAXPositionAttribute as String)
    ),
    let size = axSize(
        attribute(webArea, kAXSizeAttribute as String)
    ),
    size.width >= 360,
    size.height >= 260
else {
    fputs("Safari's focused webpage Accessibility area is unavailable.\n", stderr)
    exit(4)
}

switch mode {
case "shortcut":
    postShortcut()
case "commit":
    commitSelection()
case "full":
    postShortcut()
    Thread.sleep(forTimeInterval: 0.35)
    commitSelection()
default:
    fputs("Usage: safari-physical-input [shortcut|commit|full]\n", stderr)
    exit(5)
}

func commitSelection() {
    click(CGPoint(x: position.x + 160, y: position.y + 76))
    Thread.sleep(forTimeInterval: 0.35)
    click(CGPoint(x: position.x + 32, y: position.y + 144))
}

func postShortcut() {
    guard let source = CGEventSource(stateID: .combinedSessionState),
          let down = CGEvent(
              keyboardEventSource: source,
              virtualKey: 15,
              keyDown: true
          ),
          let up = CGEvent(
              keyboardEventSource: source,
              virtualKey: 15,
              keyDown: false
          )
    else {
        return
    }
    down.flags = [.maskControl, .maskAlternate]
    up.flags = [.maskControl, .maskAlternate]
    down.post(tap: .cghidEventTap)
    up.post(tap: .cghidEventTap)
}

func click(_ point: CGPoint) {
    guard let source = CGEventSource(stateID: .combinedSessionState),
          let move = CGEvent(
              mouseEventSource: source,
              mouseType: .mouseMoved,
              mouseCursorPosition: point,
              mouseButton: .left
          ),
          let down = CGEvent(
              mouseEventSource: source,
              mouseType: .leftMouseDown,
              mouseCursorPosition: point,
              mouseButton: .left
          ),
          let up = CGEvent(
              mouseEventSource: source,
              mouseType: .leftMouseUp,
              mouseCursorPosition: point,
              mouseButton: .left
          )
    else {
        return
    }
    move.post(tap: .cghidEventTap)
    down.post(tap: .cghidEventTap)
    up.post(tap: .cghidEventTap)
}

func descendant(
    withRole expected: String,
    of element: AXUIElement,
    depth: Int = 0
) -> AXUIElement? {
    guard depth < 16 else { return nil }
    let role: String? = attribute(element, kAXRoleAttribute as String)
    if role == expected { return element }
    let children: [AXUIElement] =
        attribute(element, kAXChildrenAttribute as String) ?? []
    for child in children {
        if let found = descendant(
            withRole: expected,
            of: child,
            depth: depth + 1
        ) {
            return found
        }
    }
    return nil
}

func attribute<T>(
    _ element: AXUIElement,
    _ name: String
) -> T? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(
        element,
        name as CFString,
        &value
    ) == .success else {
        return nil
    }
    return value as? T
}

func axPoint(_ value: AXValue?) -> CGPoint? {
    guard let value else { return nil }
    var output = CGPoint.zero
    return AXValueGetValue(
        value,
        .cgPoint,
        &output
    ) ? output : nil
}

func axSize(_ value: AXValue?) -> CGSize? {
    guard let value else { return nil }
    var output = CGSize.zero
    return AXValueGetValue(
        value,
        .cgSize,
        &output
    ) ? output : nil
}
