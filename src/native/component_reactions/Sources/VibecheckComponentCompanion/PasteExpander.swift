import AppKit
import ApplicationServices
import Foundation

private let syntheticEventMarker: Int64 = 0x5649_4245_4348_4543

final class PasteExpander {
    private var enabled = false
    private var expanding = false
    private var eventTap: CFMachPort?
    private var runLoopSource: CFRunLoopSource?

    var permissionGranted: Bool {
        AXIsProcessTrusted()
    }

    func setEnabled(_ value: Bool) throws {
        if !value {
            enabled = false
            uninstall()
            return
        }
        guard permissionGranted else {
            let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue(): true] as CFDictionary
            _ = AXIsProcessTrustedWithOptions(options)
            throw CompanionError.permission("Accessibility permission is required")
        }
        enabled = true
        try install()
    }

    private func install() throws {
        guard eventTap == nil else { return }
        let mask = CGEventMask(1 << CGEventType.keyDown.rawValue)
        let pointer = Unmanaged.passUnretained(self).toOpaque()
        guard let tap = CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: .defaultTap,
            eventsOfInterest: mask,
            callback: pasteEventCallback,
            userInfo: pointer
        ) else {
            throw CompanionError.permission("Input Monitoring permission is required")
        }
        let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
        eventTap = tap
        runLoopSource = source
        CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
    }

    private func uninstall() {
        if let eventTap {
            CGEvent.tapEnable(tap: eventTap, enable: false)
        }
        if let runLoopSource {
            CFRunLoopRemoveSource(CFRunLoopGetMain(), runLoopSource, .commonModes)
        }
        eventTap = nil
        runLoopSource = nil
    }

    fileprivate func consume(_ event: CGEvent) -> Bool {
        guard enabled,
              !expanding,
              isPhysicalCommandV(event),
              let bundle = ClipboardBundleCodec.read()
        else {
            return false
        }
        expanding = true
        let focused = focusedElement()
        DispatchQueue.main.async { [weak self] in
            self?.replay(bundle, focused: focused)
        }
        return true
    }

    private func replay(_ bundle: ClipboardBundle, focused: AXUIElement?) {
        defer {
            try? ClipboardBundleCodec.write(bundle)
            expanding = false
        }
        for entry in bundle.entries {
            ClipboardBundleCodec.writeText(entry.text)
            restoreFocus(focused)
            postPaste()
            RunLoop.current.run(until: Date().addingTimeInterval(0.08))
            ClipboardBundleCodec.writePNG(entry.png)
            restoreFocus(focused)
            postPaste()
            RunLoop.current.run(until: Date().addingTimeInterval(0.10))
        }
    }

    private func focusedElement() -> AXUIElement? {
        let system = AXUIElementCreateSystemWide()
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(
            system,
            kAXFocusedUIElementAttribute as CFString,
            &value
        ) == .success else {
            return nil
        }
        return (value as! AXUIElement)
    }

    private func restoreFocus(_ element: AXUIElement?) {
        guard let element else { return }
        _ = AXUIElementSetAttributeValue(
            element,
            kAXFocusedAttribute as CFString,
            kCFBooleanTrue
        )
    }

    private func postPaste() {
        guard let source = CGEventSource(stateID: .combinedSessionState),
              let down = CGEvent(
                  keyboardEventSource: source,
                  virtualKey: 9,
                  keyDown: true
              ),
              let up = CGEvent(
                  keyboardEventSource: source,
                  virtualKey: 9,
                  keyDown: false
              )
        else {
            return
        }
        down.flags = .maskCommand
        up.flags = .maskCommand
        down.setIntegerValueField(.eventSourceUserData, value: syntheticEventMarker)
        up.setIntegerValueField(.eventSourceUserData, value: syntheticEventMarker)
        down.post(tap: .cghidEventTap)
        up.post(tap: .cghidEventTap)
    }
}

func isPhysicalCommandV(_ event: CGEvent) -> Bool {
    event.getIntegerValueField(.eventSourceUserData) != syntheticEventMarker
        && event.getIntegerValueField(.keyboardEventKeycode) == 9
        && event.flags.contains(.maskCommand)
        && !event.flags.contains(.maskControl)
        && !event.flags.contains(.maskAlternate)
        && !event.flags.contains(.maskShift)
}

private func pasteEventCallback(
    proxy _: CGEventTapProxy,
    type: CGEventType,
    event: CGEvent,
    userInfo: UnsafeMutableRawPointer?
) -> Unmanaged<CGEvent>? {
    guard type == .keyDown, let userInfo else {
        return Unmanaged.passUnretained(event)
    }
    let expander = Unmanaged<PasteExpander>.fromOpaque(userInfo).takeUnretainedValue()
    return expander.consume(event) ? nil : Unmanaged.passUnretained(event)
}
