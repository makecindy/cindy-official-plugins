import AppKit
import Carbon
import ApplicationServices
import ScreenCaptureKit
import UniformTypeIdentifiers
import QuartzCore

let outputLock = NSLock()
func emit(_ message: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: message) else { return }
    outputLock.lock()
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([10]))
    outputLock.unlock()
}
func answer(_ id: String, _ result: [String: Any]) { emit(["id": id, "result": result]) }
func failure(_ id: String, _ code: String) { emit(["id": id, "error": code]) }

final class Overlay: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
    init(frame: NSRect, interactive: Bool) {
        super.init(contentRect: frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        isOpaque = false
        backgroundColor = .clear
        level = .popUpMenu
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]
        hidesOnDeactivate = false
        isReleasedWhenClosed = false
        ignoresMouseEvents = !interactive
        hasShadow = false
    }
}

final class PromptPanel: NSPanel, NSTextFieldDelegate {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
    var operationId: String?
    let input = NSTextField()
    let sendButton = NSButton()
    var submitted: ((String) -> Void)?
    var cancelled: (() -> Void)?
    init(id: String, label: String, prompt: String, locale: String, frame: NSRect) {
        operationId = id
        super.init(contentRect: frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        isOpaque = false; backgroundColor = .clear; hasShadow = true
        level = .popUpMenu; hidesOnDeactivate = false; isReleasedWhenClosed = false
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]
        let names = ["zh-CN": ["发送", "输入指令…"], "en": ["Send", "Type a message…"],
                     "ja": ["送信", "メッセージを入力…"], "ko": ["보내기", "메시지 입력…"]]
        let words = names[locale] ?? names["en"]!
        let surface = NSVisualEffectView(frame: NSRect(origin: .zero, size: frame.size))
        surface.material = .popover; surface.blendingMode = .withinWindow; surface.state = .active
        surface.wantsLayer = true; surface.layer?.cornerRadius = 12; surface.layer?.masksToBounds = true
        contentView = surface
        input.isBezeled = false; input.drawsBackground = false; input.focusRingType = .none
        input.usesSingleLineMode = true; input.cell?.isScrollable = true
        input.font = .systemFont(ofSize: 14); input.textColor = .labelColor
        input.placeholderString = words[1]; input.stringValue = prompt
        input.setAccessibilityLabel(label); input.delegate = self
        input.setContentHuggingPriority(.defaultLow, for: .horizontal)
        sendButton.title = words[0]; sendButton.bezelStyle = .rounded
        sendButton.font = .systemFont(ofSize: 13, weight: .medium)
        sendButton.isBordered = true; sendButton.toolTip = words[0]; sendButton.setAccessibilityLabel(words[0])
        sendButton.target = self; sendButton.action = #selector(sendInput)
        let stack = NSStackView(views: [input, sendButton]); stack.orientation = .horizontal
        stack.alignment = .centerY; stack.distribution = .fill; stack.spacing = 8; stack.translatesAutoresizingMaskIntoConstraints = false
        surface.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: surface.leadingAnchor, constant: 12),
            stack.trailingAnchor.constraint(equalTo: surface.trailingAnchor, constant: -8),
            stack.centerYAnchor.constraint(equalTo: surface.centerYAnchor),
            sendButton.widthAnchor.constraint(greaterThanOrEqualToConstant: 64),
            sendButton.heightAnchor.constraint(equalToConstant: 28)
        ])
        updateSendButton()
    }
    var isComposing: Bool { (input.currentEditor() as? NSTextView)?.hasMarkedText() == true }
    var text: String { input.currentEditor()?.string ?? input.stringValue }
    var validText: Bool {
        !isComposing && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
            text.utf16.count <= 8000 && !text.contains("\0")
    }
    func retarget(_ id: String?, label: String) {
        operationId = id; input.setAccessibilityLabel(label); updateSendButton()
    }
    override func resignKey() {
        super.resignKey()
        cancelled?()
    }
    func updateSendButton() { sendButton.isEnabled = operationId != nil && validText }
    func controlTextDidChange(_ notification: Notification) { updateSendButton() }
    func control(_ control: NSControl, textView: NSTextView, doCommandBy selector: Selector) -> Bool {
        // The native field editor owns composition and single-line text handling.
        guard control === input, !textView.hasMarkedText() else { return false }
        if selector == #selector(NSResponder.insertNewline(_:)) { sendInput(); return true }
        if selector == #selector(NSResponder.cancelOperation(_:)) { cancelInput(); return true }
        return false
    }
    @objc func sendInput() { if operationId != nil && validText { submitted?(text) } }
    @objc func cancelInput() { if !isComposing { cancelled?() } }
    func clearInput() {
        submitted = nil; cancelled = nil
        input.currentEditor()?.string = ""; input.currentEditor()?.undoManager?.removeAllActions()
        input.stringValue = ""
        orderOut(nil); close()
    }
}

final class WheelView: NSView {
    let emotes: [[String: Any]]
    let images: [String: NSImage]
    let center = NSPoint(x: 124, y: 124)
    var choices: [String: [[String: Any]]] = [:]
    var selected: Int? { didSet { if oldValue != selected { optionIndex = nil }; needsDisplay = true } }
    var optionIndex: Int? { didSet { needsDisplay = true } }
    var cancel: (() -> Void)?
    init(emotes: [[String: Any]], images: [String: NSImage]) {
        self.emotes = emotes; self.images = images
        super.init(frame: NSRect(x: 0, y: 0, width: 248, height: 248))
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
    override func hitTest(_ point: NSPoint) -> NSView? { bounds.contains(point) ? self : nil }
    override func rightMouseDown(with event: NSEvent) { cancel?() }
    func angle(_ index: Int) -> CGFloat { CGFloat(emotes[index]["angle"] as? Double ?? 0) }
    func needsTarget(_ index: Int) -> Bool { ["pick", "recent"].contains(emotes[index]["targetMode"] as? String ?? "") }
    func rows(_ index: Int) -> [[String: Any]] {
        choices[emotes[index]["targetKind"] as? String ?? ""] ?? []
    }
    func distance(_ a: CGFloat, _ b: CGFloat) -> CGFloat { abs((a - b + 540).truncatingRemainder(dividingBy: 360) - 180) }
    func branch(_ index: Int) -> (start: CGFloat, step: CGFloat, count: Int) {
        let count = rows(index).count
        let previous = index > 0 ? angle(index - 1) : angle(emotes.count - 1) - 360
        let next = index + 1 < emotes.count ? angle(index + 1) : angle(0) + 360
        let span = min(84, max(48, (next - previous) / 2 - 6))
        return (angle(index) - span / 2, span / CGFloat(max(1, count)), count)
    }
    func update(at point: NSPoint) {
        let dx = point.x - center.x, dy = point.y - center.y, radius = hypot(dx, dy)
        guard radius > 28, radius <= 240, !emotes.isEmpty else { selected = nil; return }
        if radius > 114, let index = selected, optionIndex != nil || !needsTarget(index) { return }
        let at = (atan2(dx, dy) * 180 / .pi + 360).truncatingRemainder(dividingBy: 360)
        if let index = selected, needsTarget(index), radius >= 87 {
            let b = branch(index)
            let offset = (at - b.start + 720).truncatingRemainder(dividingBy: 360)
            if b.count > 0 && offset <= b.step * CGFloat(b.count) {
                let candidate = min(b.count - 1, Int(offset / b.step))
                if let old = optionIndex {
                    let midpoint = b.start + (CGFloat(old) + 0.5) * b.step
                    if distance(at, midpoint) <= b.step / 2 + 2 { return }
                }
                optionIndex = candidate; return
            }
        }
        if radius > 114, selected != nil { return }
        let index = emotes.indices.min { distance(at, angle($0)) < distance(at, angle($1)) }
        if selected != index { selected = index } else { optionIndex = nil }
    }
    func sector(inner: CGFloat, outer: CGFloat, start: CGFloat, end: CGFloat) -> NSBezierPath {
        let path = NSBezierPath()
        path.appendArc(withCenter: center, radius: outer, startAngle: 90 - start, endAngle: 90 - end, clockwise: true)
        path.appendArc(withCenter: center, radius: inner, startAngle: 90 - end, endAngle: 90 - start, clockwise: false)
        path.close(); return path
    }
    override func draw(_ dirtyRect: NSRect) {
        let dark = effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
        func color(_ light: CGFloat, _ darkValue: CGFloat) -> NSColor { NSColor(white: dark ? darkValue : light, alpha: 1) }
        let surface = color(0.99, 0.122), border = color(0.87, 0.23), text = color(0.106, 0.83)
        let disk = NSBezierPath(ovalIn: NSRect(x: center.x - 114, y: center.y - 114, width: 228, height: 228))
        surface.setFill(); disk.fill(); border.setStroke(); disk.lineWidth = 1; disk.stroke()
        for index in emotes.indices {
            let current = angle(index)
            let previous = index > 0 ? angle(index - 1) : angle(emotes.count - 1) - 360
            let next = index + 1 < emotes.count ? angle(index + 1) : angle(0) + 360
            let start = (previous + current) / 2, end = (current + next) / 2
            let inset = min(0.65, (end - start) / 12)
            let slice = sector(inner: 28, outer: 110, start: start + inset, end: end - inset)
            (selected == index ? color(0.89, 0.24) : surface).setFill(); slice.fill()
            (selected == index ? color(0.55, 0.55) : border).setStroke(); slice.lineWidth = selected == index ? 1 : 0.65; slice.stroke()
            let size = min(56, 59 * min(current - previous, next - current) * .pi / 180 * 0.8)
            let a = current * .pi / 180
            let frame = NSRect(x: center.x + sin(a) * 59 - size / 2, y: center.y + cos(a) * 59 - size / 2, width: size, height: size)
            if let image = images[emotes[index]["id"] as? String ?? ""] { image.draw(in: frame) }
            else { (emotes[index]["emoji"] as? String ?? "").draw(in: frame, withAttributes: [.font: NSFont.systemFont(ofSize: size * 0.75)]) }
        }
        let paragraph = NSMutableParagraphStyle(); paragraph.alignment = .center
        "×".draw(in: NSRect(x: center.x - 18, y: center.y - 16, width: 36, height: 32), withAttributes: [
            .font: NSFont.systemFont(ofSize: 24, weight: .light), .foregroundColor: color(0.55, 0.55), .paragraphStyle: paragraph])
        guard let index = selected, needsTarget(index) else { return }
        let b = branch(index)
        for row in 0..<b.count {
            let start = b.start + CGFloat(row) * b.step
            let path = sector(inner: 87, outer: 111, start: start + 0.5, end: start + b.step - 0.5)
            (optionIndex == row ? color(0.80, 0.35) : color(0.95, 0.19)).setFill(); path.fill()
            border.setStroke(); path.lineWidth = 0.7; path.stroke()
            let a = (start + b.step / 2) * .pi / 180
            let width = min(45, max(24, b.step * .pi / 180 * 99 - 4))
            let frame = NSRect(x: center.x + sin(a) * 99 - width / 2, y: center.y + cos(a) * 99 - 11, width: width, height: 22)
            let label = rows(index)[row]["label"] as? String ?? ""
            paragraph.lineBreakMode = .byCharWrapping
            String(label.prefix(12)).draw(in: frame, withAttributes: [.font: NSFont.systemFont(ofSize: 9), .foregroundColor: text, .paragraphStyle: paragraph])
        }
    }
}

func cgPoint(_ point: NSPoint) -> CGPoint {
    // AppKit origin is the bottom-left of the primary display. Negative coordinates
    // on displays left/above it remain valid; never use the current screen height.
    CGPoint(x: point.x, y: (NSScreen.screens.first?.frame.maxY ?? 0) - point.y)
}
func targetAt(_ point: NSPoint) -> [String: Any] {
    let cg = cgPoint(point)
    let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
    for window in windows {
        guard let pid = window[kCGWindowOwnerPID as String] as? Int32, pid != getpid(),
              let layer = window[kCGWindowLayer as String] as? Int, layer == 0,
              let bounds = window[kCGWindowBounds as String] as? [String: Any],
              let rect = CGRect(dictionaryRepresentation: bounds as CFDictionary), rect.contains(cg),
              let number = window[kCGWindowNumber as String] as? UInt32 else { continue }
        return ["pid": pid, "windowId": number, "bounds": bounds,
                "app": window[kCGWindowOwnerName as String] as? String ?? "",
                "title": window[kCGWindowName as String] as? String ?? "",
                "bundleId": NSRunningApplication(processIdentifier: pid)?.bundleIdentifier ?? ""]
    }
    return [:]
}
func axValue(_ element: AXUIElement, _ attribute: CFString) -> CFTypeRef? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, attribute, &value) == .success else { return nil }
    return value
}
func axElement(_ element: AXUIElement, _ attribute: CFString) -> AXUIElement? {
    guard let value = axValue(element, attribute), CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
    return (value as! AXUIElement)
}
func axString(_ element: AXUIElement, _ attribute: CFString, limit: Int = 12000) -> String {
    guard let value = axValue(element, attribute) as? String else { return "" }
    return String(value.prefix(limit))
}
func sameWindow(_ element: AXUIElement, _ target: [String: Any]) -> Bool {
    guard let pid = target["pid"] as? Int32, let id = target["windowId"] as? UInt32,
          let dict = target["bounds"] as? [String: Any], let bounds = CGRect(dictionaryRepresentation: dict as CFDictionary) else { return false }
    let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
    // Public AX attributes expose bounds, not a reliable CG window ID. Require a
    // unique same-process match to the original ID; ambiguous windows yield no text.
    let matches = windows.filter { candidate in
        guard candidate[kCGWindowOwnerPID as String] as? Int32 == pid,
              candidate[kCGWindowLayer as String] as? Int == 0,
              let dict = candidate[kCGWindowBounds as String] as? [String: Any],
              let rect = CGRect(dictionaryRepresentation: dict as CFDictionary) else { return false }
        return abs(rect.minX - bounds.minX) < 3 && abs(rect.minY - bounds.minY) < 3 &&
               abs(rect.width - bounds.width) < 3 && abs(rect.height - bounds.height) < 3
    }
    guard matches.count == 1, matches[0][kCGWindowNumber as String] as? UInt32 == id else { return false }
    guard let window = axElement(element, kAXWindowAttribute as CFString),
          let rawPosition = axValue(window, kAXPositionAttribute as CFString),
          let rawSize = axValue(window, kAXSizeAttribute as CFString),
          CFGetTypeID(rawPosition) == AXValueGetTypeID(), CFGetTypeID(rawSize) == AXValueGetTypeID() else { return false }
    var position = CGPoint.zero
    var size = CGSize.zero
    guard AXValueGetValue(rawPosition as! AXValue, .cgPoint, &position),
          AXValueGetValue(rawSize as! AXValue, .cgSize, &size) else { return false }
    return abs(position.x - bounds.minX) < 3 && abs(position.y - bounds.minY) < 3 &&
           abs(size.width - bounds.width) < 3 && abs(size.height - bounds.height) < 3
}
func isSecure(_ element: AXUIElement) -> Bool {
    axString(element, kAXSubroleAttribute as CFString) == "AXSecureTextField" ||
        (axValue(element, "AXProtectedContent" as CFString) as? Bool == true)
}
func textAt(_ event: [String: Any]) -> (String, [String]) {
    guard AXIsProcessTrusted() else { return ("", ["ACCESSIBILITY_REQUIRED"]) }
    guard let target = event["target"] as? [String: Any], let pid = target["pid"] as? Int32,
          let point = event["point"] as? [String: Double], let x = point["x"], let y = point["y"] else { return ("", ["WINDOW_MISSING"]) }
    let app = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(app, 0.15)
    var hit: AXUIElement?
    guard AXUIElementCopyElementAtPosition(app, Float(x), Float(y), &hit) == .success, let element = hit,
          sameWindow(element, target), !isSecure(element) else { return ("", ["TEXT_UNAVAILABLE"]) }
    var lines: [String] = []
    if let focus = axElement(app, kAXFocusedUIElementAttribute as CFString), sameWindow(focus, target), !isSecure(focus) {
        let selection = axString(focus, kAXSelectedTextAttribute as CFString)
        if !selection.isEmpty { lines.append("Selected text:\n" + selection) }
    }
    for (label, attribute) in [("Role", kAXRoleAttribute), ("Title", kAXTitleAttribute),
                               ("Description", kAXDescriptionAttribute), ("Value", kAXValueAttribute), ("URL", kAXURLAttribute)] {
        let value = axString(element, attribute as CFString, limit: attribute == kAXValueAttribute ? 12000 : 2000)
        if !value.isEmpty { lines.append(label + ": " + value) }
    }
    // Bounded nearby content; no traversal of the whole app and no clipboard access.
    if let children = axValue(element, kAXChildrenAttribute as CFString) as? [AXUIElement] {
        for child in children.prefix(12) where !isSecure(child) {
            let value = axString(child, kAXValueAttribute as CFString, limit: 800)
            let title = axString(child, kAXTitleAttribute as CFString, limit: 400)
            if !value.isEmpty || !title.isEmpty { lines.append([title, value].filter { !$0.isEmpty }.joined(separator: ": ")) }
        }
    }
    guard sameWindow(element, target) else { return ("", ["TEXT_UNAVAILABLE"]) }
    return (String(lines.joined(separator: "\n").prefix(20000)), [])
}

func screenshot(_ event: [String: Any]) async -> (String?, [String]) {
    guard CGPreflightScreenCaptureAccess() else { return (nil, ["SCREEN_RECORDING_REQUIRED"]) }
    guard let target = event["target"] as? [String: Any], let windowId = target["windowId"] as? UInt32,
          let pid = target["pid"] as? Int32 else { return (nil, ["WINDOW_MISSING"]) }
    do {
        let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true)
        guard let window = content.windows.first(where: { $0.windowID == windowId && $0.owningApplication?.processID == pid }) else {
            return (nil, ["WINDOW_MISSING"])
        }
        let config = SCStreamConfiguration()
        let scale = min(1.0, 1600.0 / max(window.frame.width, window.frame.height))
        config.width = max(1, Int(window.frame.width * scale))
        config.height = max(1, Int(window.frame.height * scale))
        config.showsCursor = false
        config.ignoreShadowsSingleWindow = true
        // Captures exactly the original target window, excluding all overlay windows.
        let image = try await SCScreenshotManager.captureImage(contentFilter: SCContentFilter(desktopIndependentWindow: window), configuration: config)
        let bitmap = NSBitmapImageRep(cgImage: image)
        for quality in [0.70, 0.45, 0.25] {
            if let data = bitmap.representation(using: .jpeg, properties: [.compressionFactor: quality]), data.count <= 550000 {
                return (data.base64EncodedString(), [])
            }
        }
        return (nil, ["IMAGE_TOO_LARGE"])
    } catch { return (nil, ["SCREENSHOT_FAILED"]) }
}

// Mutable UI state is confined to the main thread. Detached capture work passes
// immutable values, and its only completion mutation is dispatched to main.
final class Controller: NSObject, NSApplicationDelegate, @unchecked Sendable {
    var emotes: [[String: Any]] = []
    var images: [String: NSImage] = [:]
    var enabled = false
    var wheelKeyCode = UInt32(kVK_ANSI_G)
    var wheelFlags: CGEventFlags = [.maskCommand]
    var modifierOnly = UInt32(0)
    var wheelModifiers = UInt32(cmdKey)
    var inputTap: CFMachPort?
    var inputSource: CFRunLoopSource?
    var inputTimer: Timer?
    var inputActive = false
    var hotkeyReady: Bool { inputActive && inputTap.map { CGEvent.tapIsEnabled(tap: $0) } == true }
    let modifierMask: CGEventFlags = [.maskControl, .maskAlternate, .maskShift, .maskCommand]
    enum Gesture: String { case idle, wheel, cancelled }
    var gesture = Gesture.idle
    var triggerDown = false
    var foreignKey = false
    var heldKeys: Set<CGKeyCode> = []
    var swallowedKeys: Set<CGKeyCode> = []
    var swallowRightUp = false
    var swallowLeftUp = false
    var lastMouseActivity = ProcessInfo.processInfo.systemUptime
    var recordingShortcut = false
    var recordingTimer: Timer?
    var overlays: [Overlay] = []
    var picker: Overlay?
    var wheelGestureId: String?
    var wheel: WheelView?
    var anchor = NSPoint.zero
    var captureBusy = false
    var locale = "en"
    var configRevision = ""
    var promptPanel: PromptPanel?
    // Projection of Node's current unsent operation, never an authorization source.
    var pendingGestureId: String?

    func applicationDidFinishLaunching(_ notification: Notification) {
        emit(["kind": "ready", "permissions": permissions()])
    }
    func permissions() -> [String: Any] {
        ["accessibility": AXIsProcessTrusted(), "screenRecording": CGPreflightScreenCaptureAccess(),
         "keyboardMonitoring": CGPreflightListenEventAccess()]
    }
    func configure(_ params: [String: Any]) -> [String: Any] {
        unregisterWheel()
        closePicker()
        closeInput()
        recordingTimer?.invalidate()
        recordingTimer = nil
        recordingShortcut = false
        enabled = params["enabled"] as? Bool ?? false
        let shortcut = params["wheelShortcut"] as? [String: Any] ?? [:]
        wheelKeyCode = shortcut["keyCode"] as? UInt32 ?? UInt32(kVK_ANSI_G)
        wheelModifiers = shortcut["modifiers"] as? UInt32 ?? UInt32(cmdKey)
        modifierOnly = shortcut["modifierOnly"] as? UInt32 ?? 0
        wheelFlags = []
        for (carbon, flag) in [(controlKey, CGEventFlags.maskControl), (optionKey, .maskAlternate),
                               (shiftKey, .maskShift), (cmdKey, .maskCommand)] {
            if wheelModifiers & UInt32(carbon) != 0 { wheelFlags.insert(flag) }
        }
        for (bit, flag) in [(1, CGEventFlags.maskControl), (2, .maskAlternate), (4, .maskShift), (8, .maskCommand)] {
            if modifierOnly & UInt32(bit) != 0 { wheelFlags.insert(flag) }
        }
        locale = params["locale"] as? String ?? "en"
        configRevision = params["configRevision"] as? String ?? ""
        emotes = params["emotes"] as? [[String: Any]] ?? []
        images = [:]
        var issues: [String] = []
        for emote in emotes {
            if let path = emote["imagePath"] as? String, !path.isEmpty, let id = emote["id"] as? String {
                if let attrs = try? FileManager.default.attributesOfItem(atPath: path),
                   let bytes = attrs[.size] as? NSNumber, bytes.intValue <= 8 * 1024 * 1024,
                   let image = NSImage(contentsOfFile: path) { images[id] = image }
                else { issues.append("IMAGE_UNAVAILABLE") }
            }
        }
        if enabled && !registerWheel() { issues.append(AXIsProcessTrusted() ? "INPUT_HOOK_FAILED" : "INPUT_ACCESS_REQUIRED") }
        return ["enabled": enabled && hotkeyReady, "permissions": permissions(), "issues": issues]
    }
    func unregisterWheel() {
        inputActive = false
        cancelPickerGesture()
        // Keep only the matching releases while a consumed press is still held.
        // Recording/disable must not leak an orphan mouse-up to the application.
        disposeInputIfIdle()
    }
    func disposeInputIfIdle() {
        guard !inputActive, gesture == .idle, swallowedKeys.isEmpty, !swallowRightUp, !swallowLeftUp else { return }
        inputTimer?.invalidate(); inputTimer = nil
        if let source = inputSource { CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes) }
        if let tap = inputTap { CGEvent.tapEnable(tap: tap, enable: false); CFMachPortInvalidate(tap) }
        inputSource = nil; inputTap = nil
        heldKeys = []; triggerDown = false; foreignKey = false
    }
    func registerWheel() -> Bool {
        guard AXIsProcessTrusted() else { return false }
        if inputTap == nil {
            let types: [CGEventType] = [.keyDown, .keyUp, .flagsChanged, .leftMouseDown, .leftMouseUp,
                                       .rightMouseDown, .rightMouseUp, .mouseMoved, .leftMouseDragged]
            let mask = types.reduce(CGEventMask(0)) { $0 | (CGEventMask(1) << $1.rawValue) }
            guard let tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap,
                options: .defaultTap, eventsOfInterest: mask, callback: { _, type, event, context in
                    guard let context = context else { return Unmanaged.passUnretained(event) }
                    let owner = Unmanaged<Controller>.fromOpaque(context).takeUnretainedValue()
                    return owner.handleInput(type, event: event) ? nil : Unmanaged.passUnretained(event)
                }, userInfo: Unmanaged.passUnretained(self).toOpaque()),
                let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0) else { return false }
            inputTap = tap; inputSource = source
            CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
            let timer = Timer(timeInterval: 1, repeats: true) { [weak self] _ in self?.recoverInput() }
            inputTimer = timer; RunLoop.main.add(timer, forMode: .common)
        }
        heldKeys = Set((0..<128).compactMap { key -> CGKeyCode? in
            guard !(54...63).contains(key), CGEventSource.keyState(.combinedSessionState, key: CGKeyCode(key)) else { return nil }
            return CGKeyCode(key)
        }).union(swallowedKeys)
        let flags = CGEventSource.flagsState(.combinedSessionState).intersection(modifierMask)
        triggerDown = isTriggerHeld(flags)
        // Never claim a gesture already in progress while settings are applied.
        foreignKey = triggerDown
        inputActive = true
        if let tap = inputTap { CGEvent.tapEnable(tap: tap, enable: true) }
        return hotkeyReady
    }
    func isTriggerHeld(_ flags: CGEventFlags) -> Bool {
        flags.contains(wheelFlags) && (modifierOnly != 0 || heldKeys.contains(CGKeyCode(wheelKeyCode)))
    }
    func updateTrigger(_ flags: CGEventFlags, at point: CGPoint) {
        let held = isTriggerHeld(flags)
        if !held {
            let confirm = triggerDown && gesture == .wheel && !foreignKey && inputActive && enabled
            triggerDown = false
            if confirm { finishPicker(at: point) } else { closePicker() }
            gesture = .idle; foreignKey = false
        } else {
            if flags != wheelFlags || heldKeys.contains(where: {
                !swallowedKeys.contains($0) && (modifierOnly != 0 || $0 != CGKeyCode(wheelKeyCode))
            }) { foreignKey = true }
            if foreignKey { cancelPickerGesture() }
            else if !triggerDown && inputActive && enabled && !recordingShortcut {
                gesture = .wheel; lastMouseActivity = ProcessInfo.processInfo.systemUptime
                showPicker(at: point)
            }
            triggerDown = true
        }
    }
    func cancelPickerGesture() {
        if gesture == .wheel { gesture = .cancelled }
        closePicker()
    }
    func recoverInput() {
        guard let tap = inputTap else { return }
        if !CGEvent.tapIsEnabled(tap: tap) {
            cancelPickerGesture(); CGEvent.tapEnable(tap: tap, enable: true)
        }
        if gesture == .wheel, ProcessInfo.processInfo.systemUptime - lastMouseActivity > 30 { cancelPickerGesture() }
        heldKeys = heldKeys.filter { swallowedKeys.contains($0) || CGEventSource.keyState(.combinedSessionState, key: $0) }
        // Recovery may cancel a lost release, but must never confirm it.
        if triggerDown && !isTriggerHeld(CGEventSource.flagsState(.combinedSessionState).intersection(modifierMask)) {
            cancelPickerGesture(); triggerDown = false; foreignKey = false; gesture = .idle
        }
        disposeInputIfIdle()
    }
    func handleInput(_ type: CGEventType, event: CGEvent) -> Bool {
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            cancelPickerGesture()
            if let tap = inputTap { CGEvent.tapEnable(tap: tap, enable: true) }
            return false
        }
        let flags = event.flags.intersection(modifierMask)
        let key = CGKeyCode(event.getIntegerValueField(.keyboardEventKeycode))
        if [.leftMouseDown, .leftMouseUp, .leftMouseDragged, .mouseMoved].contains(type) {
            lastMouseActivity = ProcessInfo.processInfo.systemUptime
        }
        if type == .keyUp {
            heldKeys.remove(key); updateTrigger(flags, at: event.location)
            let swallow = swallowedKeys.remove(key) != nil
            DispatchQueue.main.async { [weak self] in self?.disposeInputIfIdle() }
            return swallow
        }
        if type == .rightMouseUp && swallowRightUp { swallowRightUp = false; disposeInputIfIdle(); return true }
        if type == .leftMouseUp && swallowLeftUp { swallowLeftUp = false; disposeInputIfIdle(); return true }
        guard inputActive, enabled, !recordingShortcut else { disposeInputIfIdle(); return false }
        if type == .keyDown {
            if event.getIntegerValueField(.keyboardEventAutorepeat) == 0 { swallowedKeys.remove(key) }
            if key == CGKeyCode(kVK_Escape), gesture == .wheel {
                swallowedKeys.insert(key); foreignKey = true; cancelPickerGesture()
                if let id = pendingGestureId {
                    closeInput()
                    emit(["kind": "cancel-action", "gestureId": id])
                }
                return true
            }
            if key == CGKeyCode(kVK_Escape), flags.isEmpty, event.getIntegerValueField(.keyboardEventAutorepeat) == 0 {
                if let panel = promptPanel {
                    if !panel.isKeyWindow && !panel.isComposing {
                        swallowedKeys.insert(key); panel.cancelInput(); return true
                    }
                } else if let id = pendingGestureId {
                    swallowedKeys.insert(key); pendingGestureId = nil
                    emit(["kind": "cancel-action", "gestureId": id]); return true
                }
            }
            heldKeys.insert(key); updateTrigger(flags, at: event.location)
            if swallowedKeys.contains(key) { return true }
            if modifierOnly == 0, key == CGKeyCode(wheelKeyCode), flags == wheelFlags, !foreignKey {
                swallowedKeys.insert(key); return true
            }
            return false
        }
        updateTrigger(flags, at: event.location)
        if type == .rightMouseDown && gesture == .wheel {
            swallowRightUp = true; foreignKey = true; cancelPickerGesture(); return true
        }
        if type == .leftMouseDown && gesture == .wheel { swallowLeftUp = true; return true }
        if (type == .mouseMoved || type == .leftMouseDragged) && gesture == .wheel { updatePicker(at: event.location) }
        return false
    }
    func setRecording(_ active: Bool) -> [String: Any] {
        recordingTimer?.invalidate()
        recordingTimer = nil
        closePicker()
        unregisterWheel()
        closeInput()
        recordingShortcut = active
        var issues: [String] = []
        if active {
            // Recover even if the settings page closes before sending its finish message.
            let timer = Timer(timeInterval: 30, repeats: false) { [weak self] _ in _ = self?.setRecording(false) }
            recordingTimer = timer
            RunLoop.main.add(timer, forMode: .common)
        } else if enabled && !registerWheel() { issues.append(AXIsProcessTrusted() ? "INPUT_HOOK_FAILED" : "INPUT_ACCESS_REQUIRED") }
        return ["issues": issues]
    }
    func content(_ emote: [String: Any], frame: NSRect) -> NSView {
        if let id = emote["id"] as? String, let image = images[id] {
            let view = NSImageView(frame: frame)
            view.image = image
            view.imageScaling = .scaleProportionallyUpOrDown
            view.animates = true
            return view
        }
        let label = NSTextField(labelWithString: emote["emoji"] as? String ?? "🙂")
        label.frame = frame
        label.font = .systemFont(ofSize: frame.height * 0.7)
        label.alignment = .center
        if ["❓", "?", "？"].contains(emote["emoji"] as? String ?? "") {
            let shadow = NSShadow()
            shadow.shadowColor = NSColor.black.withAlphaComponent(0.8)
            shadow.shadowBlurRadius = 5
            label.attributedStringValue = NSAttributedString(string: "?", attributes: [
                .font: NSFont.systemFont(ofSize: frame.height * 0.8, weight: .heavy),
                .foregroundColor: NSColor(calibratedRed: 1, green: 0.79, blue: 0.25, alpha: 1),
                .strokeColor: NSColor(calibratedRed: 0.28, green: 0.16, blue: 0.04, alpha: 1),
                .strokeWidth: -3, .shadow: shadow])
            label.alignment = .center
        }
        return label
    }
    func trigger(_ index: Int, at point: NSPoint, gestureId: String, optionIndex: Int?) {
        guard enabled, emotes.indices.contains(index) else { return }
        let emote = emotes[index]
        closePicker()
        prepareInput(for: emote, gestureId: gestureId)
        // No accessibility queries, capture, IPC or model work precedes display.
        // Extra transparent room keeps the spring overshoot and ripple unclipped.
        let overlay = Overlay(frame: NSRect(x: point.x - 72, y: point.y - 36, width: 144, height: 144), interactive: false)
        let stage = overlay.contentView!
        stage.wantsLayer = true
        let icon = content(emote, frame: NSRect(x: 16, y: 16, width: 112, height: 112))
        stage.addSubview(icon)
        let reducedMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        if !reducedMotion {
            for delay in [0.0, 0.11] {
                let ripple = CAShapeLayer()
                ripple.bounds = CGRect(x: 0, y: 0, width: 66, height: 23)
                ripple.position = CGPoint(x: 72, y: 22)
                ripple.path = CGPath(ellipseIn: ripple.bounds.insetBy(dx: 1, dy: 1), transform: nil)
                ripple.fillColor = nil
                ripple.strokeColor = NSColor(calibratedRed: 0.80, green: 0.64, blue: 0.32, alpha: 1).cgColor
                ripple.lineWidth = delay == 0 ? 2 : 1
                ripple.opacity = 0
                stage.layer?.insertSublayer(ripple, at: 0)
                let spread = CABasicAnimation(keyPath: "transform.scale")
                spread.fromValue = 0.15; spread.toValue = 1.9
                let fade = CAKeyframeAnimation(keyPath: "opacity")
                fade.values = [0, 0.8, 0]; fade.keyTimes = [0, 0.1, 1]
                let group = CAAnimationGroup()
                group.animations = [spread, fade]; group.duration = 0.6
                group.beginTime = CACurrentMediaTime() + delay
                group.timingFunction = CAMediaTimingFunction(name: .easeOut)
                ripple.add(group, forKey: "ripple")
            }
            icon.wantsLayer = true
            let spring = CAKeyframeAnimation(keyPath: "transform")
            spring.values = [(0.18, 0.12, -17.0, -13.0), (0.64, 0.65, -8, -5),
                             (1.14, 1.17, 9, 4), (1.04, 0.92, -2, -3), (0.98, 1.03, 2, 1), (1, 1, 0, 0)].map { sx, sy, y, degrees in
                var transform = CATransform3DMakeTranslation(0, CGFloat(y), 0)
                transform = CATransform3DRotate(transform, CGFloat(degrees * .pi / 180), 0, 0, 1)
                return NSValue(caTransform3D: CATransform3DScale(transform, CGFloat(sx), CGFloat(sy), 1))
            }
            spring.keyTimes = [0, 0.12, 0.44, 0.66, 0.84, 1]
            spring.duration = 0.46
            spring.timingFunctions = Array(repeating: CAMediaTimingFunction(controlPoints: 0.16, 0.8, 0.3, 1), count: 5)
            icon.layer?.add(spring, forKey: "pop")
        }
        overlay.orderFrontRegardless()
        overlay.displayIfNeeded()
        overlays.append(overlay)
        // Each emote owns its lifetime; a new one never removes an existing one.
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { [weak self, weak overlay] in
            guard let overlay = overlay else { return }
            NSAnimationContext.runAnimationGroup({ context in
                context.duration = reducedMotion ? 0.1 : 0.2
                overlay.animator().alphaValue = 0
                if !reducedMotion { overlay.animator().setFrameOrigin(NSPoint(x: overlay.frame.minX, y: overlay.frame.minY + 8)) }
            }, completionHandler: {
                overlay.close()
                self?.overlays.removeAll { $0 === overlay }
            })
        }
        let cg = cgPoint(point)
        emit(["kind": "trigger", "emoteId": emote["id"] ?? "", "configRevision": configRevision, "at": Date().timeIntervalSince1970 * 1000,
              "point": ["x": cg.x, "y": cg.y], "gestureId": gestureId, "optionIndex": optionIndex ?? -1,
              "target": ["none", "undo"].contains(emote["action"] as? String ?? "") ? [:] : targetAt(point)])
    }
    func showPicker(at point: CGPoint) {
        guard enabled, !recordingShortcut, !emotes.isEmpty, picker == nil else { return }
        anchor = NSPoint(x: point.x, y: (NSScreen.screens.first?.frame.maxY ?? 0) - point.y)
        let view = WheelView(emotes: emotes, images: images)
        let panel = Overlay(frame: NSRect(x: anchor.x - view.center.x, y: anchor.y - view.center.y,
                                         width: view.frame.width, height: view.frame.height), interactive: true)
        panel.contentView = view
        view.cancel = { [weak self] in self?.cancelPickerGesture() }
        let gestureId = UUID().uuidString
        picker = panel; wheel = view; wheelGestureId = gestureId
        panel.orderFrontRegardless(); panel.displayIfNeeded()
        emit(["kind": "wheel-open", "gestureId": gestureId, "configRevision": configRevision])
    }
    func updatePicker(at point: CGPoint) {
        guard let panel = picker, let wheel = wheel else { return }
        let at = NSPoint(x: point.x, y: (NSScreen.screens.first?.frame.maxY ?? 0) - point.y)
        wheel.update(at: NSPoint(x: at.x - panel.frame.minX, y: at.y - panel.frame.minY))
    }
    func finishPicker(at point: CGPoint) {
        guard let view = wheel, let gestureId = wheelGestureId else { closePicker(); return }
        let selected = view.selected, option = view.optionIndex
        updatePicker(at: point)
        let valid = selected == view.selected && (selected.map {
            !view.needsTarget($0) || (option != nil && option == view.optionIndex)
        } ?? false)
        closePicker()
        if valid, let selected = selected { trigger(selected, at: anchor, gestureId: gestureId, optionIndex: option) }
    }
    func closePicker() {
        if let id = wheelGestureId { emit(["kind": "wheel-closed", "gestureId": id]) }
        picker?.close(); picker = nil; wheel = nil; wheelGestureId = nil
    }
    func closeInput() {
        promptPanel?.clearInput(); promptPanel = nil; pendingGestureId = nil
    }
    func prepareInput(for emote: [String: Any], gestureId: String) {
        let sending = !["none", "undo"].contains(emote["action"] as? String ?? "")
        if sending && emote["promptMode"] as? String == "input" {
            // Keep the same editor and draft, but never submit against the old capture.
            promptPanel?.retarget(nil, label: emote["label"] as? String ?? "Cindy Ping")
        } else { closeInput() }
        pendingGestureId = sending ? gestureId : nil
    }
    func openInput(_ params: [String: Any]) -> [String: Any] {
        guard enabled, !recordingShortcut, let id = params["id"] as? String,
              let gestureId = params["gestureId"] as? String, gestureId == pendingGestureId,
              let prompt = params["prompt"] as? String, prompt.utf16.count <= 8000 else { return ["current": false] }
        if let panel = promptPanel {
            panel.retarget(id, label: params["label"] as? String ?? "Cindy Ping")
            return ["current": true]
        }
        let point = params["point"] as? [String: Double] ?? [:]
        let at = NSPoint(x: point["x"] ?? 0, y: (NSScreen.screens.first?.frame.maxY ?? 0) - (point["y"] ?? 0))
        let screen = (NSScreen.screens.first { $0.frame.contains(at) } ?? NSScreen.main)?.visibleFrame ?? NSRect(x: 0, y: 0, width: 800, height: 600)
        let width = min(360, screen.width - 24), height: CGFloat = 44
        let origin = NSPoint(x: min(max(at.x - width / 2, screen.minX + 12), screen.maxX - width - 12),
                             y: min(max(at.y - height - 48, screen.minY + 12), screen.maxY - height - 12))
        let panel = PromptPanel(id: id, label: params["label"] as? String ?? "Cindy Ping", prompt: prompt,
                                locale: locale, frame: NSRect(origin: origin, size: NSSize(width: width, height: height)))
        promptPanel = panel
        panel.submitted = { [weak self, weak panel] text in
            guard let self = self, let panel = panel, self.promptPanel === panel,
                  let id = panel.operationId else { return }
            emit(["kind": "input-submit", "id": id, "text": text])
            panel.clearInput(); self.promptPanel = nil
        }
        panel.cancelled = { [weak self, weak panel] in
            guard let self = self, let panel = panel, self.promptPanel === panel else { return }
            let gestureId = self.pendingGestureId
            self.closeInput()
            if let gestureId = gestureId { emit(["kind": "cancel-action", "gestureId": gestureId]) }
        }
        panel.makeKeyAndOrderFront(nil); panel.makeFirstResponder(panel.input)
        (panel.input.currentEditor() as? NSTextView)?.setSelectedRange(NSRange(location: prompt.utf16.count, length: 0))
        return ["current": true]
    }
    func thumbnail(_ image: NSImage) -> String? {
        guard image.size.width > 0, image.size.height > 0,
              let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 64, pixelsHigh: 64,
                bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
                bytesPerRow: 0, bitsPerPixel: 0) else { return nil }
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
        let scale = min(64 / image.size.width, 64 / image.size.height)
        let size = NSSize(width: image.size.width * scale, height: image.size.height * scale)
        image.draw(in: NSRect(x: (64 - size.width) / 2, y: (64 - size.height) / 2, width: size.width, height: size.height))
        NSGraphicsContext.restoreGraphicsState()
        guard let data = bitmap.representation(using: .png, properties: [:]) else { return nil }
        return "data:image/png;base64," + data.base64EncodedString()
    }
    func command(_ request: [String: Any]) {
        guard let id = request["id"] as? String, let method = request["method"] as? String else { return }
        let params = request["params"] as? [String: Any] ?? [:]
        switch method {
        case "configure": answer(id, configure(params))
        case "openInput": answer(id, openInput(params))
        case "closeInput":
            let closesOperation = (params["id"] as? String).map { $0 == promptPanel?.operationId } ?? false
            let closesGesture = params["keepPending"] as? Bool != true &&
                (params["gestureId"] as? String).map { $0 == pendingGestureId } == true
            if closesOperation || closesGesture {
                promptPanel?.clearInput(); promptPanel = nil
            }
            if closesGesture { pendingGestureId = nil }
            answer(id, [:])
        case "status":
            // Recheck Cindy's existing access without requesting OS authorization.
            if enabled && !recordingShortcut && inputTap == nil && AXIsProcessTrusted() { _ = registerWheel() }
            answer(id, ["enabled": enabled && hotkeyReady, "permissions": permissions(),
                        "issues": enabled && !recordingShortcut && !hotkeyReady ? [AXIsProcessTrusted() ? "INPUT_HOOK_FAILED" : "INPUT_ACCESS_REQUIRED"] : [],
                        "gesture": gesture.rawValue, "inputMode": "key-hold",
                        "wheelVisible": picker != nil, "wheelShortcut": ["keyCode": wheelKeyCode, "modifiers": wheelModifiers, "modifierOnly": modifierOnly]])
        case "theme":
            NSApp.appearance = NSAppearance(named: (params["dark"] as? Bool == true) ? .darkAqua : .aqua)
            wheel?.needsDisplay = true
            answer(id, [:])
        case "previewImages":
            var previews: [String: String] = [:]
            var bytes = 0
            for (key, image) in images {
                if let preview = thumbnail(image), bytes + preview.utf8.count < 800000 {
                    previews[key] = preview; bytes += preview.utf8.count
                }
            }
            answer(id, ["images": previews])
        case "shortcutRecording": answer(id, setRecording(params["active"] as? Bool ?? false))
        case "wheelTargets":
            guard params["gestureId"] as? String == wheelGestureId, let wheel = wheel,
                  let choices = params["choices"] as? [String: [[String: Any]]] else { answer(id, ["current": false]); return }
            wheel.choices = choices.mapValues { Array($0.prefix(3)) }; wheel.needsDisplay = true
            answer(id, ["current": true])
        case "pickImage":
            let panel = NSOpenPanel()
            panel.allowedContentTypes = [.png, .jpeg, .gif, .webP]
            panel.canChooseDirectories = false
            panel.allowsMultipleSelection = false
            panel.begin { result in
                guard result == .OK, let url = panel.url else { answer(id, ["path": ""]); return }
                guard let attrs = try? FileManager.default.attributesOfItem(atPath: url.path),
                      let bytes = attrs[.size] as? NSNumber, bytes.intValue <= 8 * 1024 * 1024,
                      let image = NSImage(contentsOf: url), let preview = self.thumbnail(image) else {
                    failure(id, "IMAGE_UNAVAILABLE"); return
                }
                answer(id, ["path": url.path, "preview": preview])
            }
        case "capture":
            guard !captureBusy else { failure(id, "CAPTURE_BUSY"); return }
            captureBusy = true
            let event = params["event"] as? [String: Any] ?? [:]
            let wantsScreenshot = params["screenshot"] as? Bool ?? true
            let capturedAt = Date().timeIntervalSince1970 * 1000
            Task.detached { [weak self] in
                async let image = wantsScreenshot ? screenshot(event) : (nil, [])
                let (text, textIssues) = textAt(event)
                let (jpeg, screenshotIssues) = await image
                var result: [String: Any] = ["text": text, "issues": textIssues + screenshotIssues,
                                             "capturedAt": capturedAt, "source": event]
                if let jpeg = jpeg { result["jpeg"] = jpeg }
                DispatchQueue.main.async {
                    self?.captureBusy = false
                    answer(id, result)
                }
            }
        case "shutdown": answer(id, [:]); NSApp.terminate(nil)
        default: failure(id, "METHOD_UNKNOWN")
        }
    }
}

let application = NSApplication.shared
application.setActivationPolicy(.accessory)
let controller = Controller()
application.delegate = controller
DispatchQueue.global(qos: .userInitiated).async {
    while let line = readLine() {
        guard line.utf8.count <= 262144, let data = line.data(using: .utf8),
              let request = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }
        DispatchQueue.main.async { controller.command(request) }
    }
    // Parent/worker death closes stdin, so the overlay and global shortcuts die too.
    DispatchQueue.main.async { NSApp.terminate(nil) }
}
application.run()
