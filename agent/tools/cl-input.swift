// cl-input: click, scroll și tastatură pe Mac, pentru controlul de pe telefon.
// Agentul îl compilează singur (swiftc) și îl apelează pentru fiecare acțiune.
//
//   cl-input check                      → „trusted” sau „untrusted” (cere permisiunea)
//   cl-input status                     → la fel, fără să deschidă cererea
//   cl-input click <display> <x> <y> [left|right|double]
//   cl-input scroll <display> <x> <y> <dy>
//   cl-input type <text>
//   cl-input key <name> [cmd,shift,alt,ctrl]
//
// x și y sunt fracții (0…1) din ecranul cu numărul <display> (1 = principal),
// aceeași numerotare ca la `screencapture -D`.

import ApplicationServices
import Foundation

func fail(_ message: String) -> Never {
    FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
    exit(1)
}

let args = Array(CommandLine.arguments.dropFirst())
guard let command = args.first else { fail("lipsește comanda") }

// Fără Accessibility, macOS ignoră în tăcere evenimentele; verificăm înainte.
func requireTrust() {
    let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
    if !AXIsProcessTrustedWithOptions(options) {
        fail("untrusted")
    }
}

func displayPoint(_ display: Int, _ fx: Double, _ fy: Double) -> CGPoint {
    var count: UInt32 = 0
    CGGetActiveDisplayList(0, nil, &count)
    var ids = [CGDirectDisplayID](repeating: 0, count: Int(count))
    CGGetActiveDisplayList(count, &ids, &count)
    // Ecranul principal primul, apoi celelalte, ca la screencapture -D.
    let main = CGMainDisplayID()
    let ordered = [main] + ids.filter { $0 != main }
    guard display >= 1, display <= ordered.count else { fail("ecranul \(display) nu există") }
    let b = CGDisplayBounds(ordered[display - 1])
    let x = b.origin.x + max(0, min(1, fx)) * b.width
    let y = b.origin.y + max(0, min(1, fy)) * b.height
    return CGPoint(x: x.rounded(), y: y.rounded())
}

let source = CGEventSource(stateID: .hidSystemState)

func post(_ event: CGEvent?) {
    event?.post(tap: .cghidEventTap)
    usleep(12_000)
}

func click(at p: CGPoint, kind: String) {
    post(CGEvent(mouseEventSource: source, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: .left))
    let right = kind == "right"
    let down: CGEventType = right ? .rightMouseDown : .leftMouseDown
    let up: CGEventType = right ? .rightMouseUp : .leftMouseUp
    let button: CGMouseButton = right ? .right : .left
    let clicks = kind == "double" ? 2 : 1
    for n in 1...clicks {
        let d = CGEvent(mouseEventSource: source, mouseType: down, mouseCursorPosition: p, mouseButton: button)
        let u = CGEvent(mouseEventSource: source, mouseType: up, mouseCursorPosition: p, mouseButton: button)
        d?.setIntegerValueField(.mouseEventClickState, value: Int64(n))
        u?.setIntegerValueField(.mouseEventClickState, value: Int64(n))
        post(d)
        post(u)
    }
}

let keyCodes: [String: CGKeyCode] = [
    "return": 36, "enter": 36, "tab": 48, "space": 49, "delete": 51, "backspace": 51,
    "escape": 53, "esc": 53, "left": 123, "right": 124, "down": 125, "up": 126,
    "forwarddelete": 117, "home": 115, "end": 119, "pageup": 116, "pagedown": 121,
    "a": 0, "c": 8, "v": 9, "x": 7, "z": 6, "w": 13, "q": 12, "s": 1, "f": 3, "n": 45, "t": 17,
]

switch command {
case "check":
    let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
    print(AXIsProcessTrustedWithOptions(options) ? "trusted" : "untrusted")

case "status":
    // Ca „check”, dar fără să deschidă cererea de permisiune pe Mac.
    print(AXIsProcessTrusted() ? "trusted" : "untrusted")

case "click":
    guard args.count >= 4, let d = Int(args[1]), let x = Double(args[2]), let y = Double(args[3]) else { fail("click <display> <x> <y> [left|right|double]") }
    requireTrust()
    click(at: displayPoint(d, x, y), kind: args.count > 4 ? args[4] : "left")

case "scroll":
    guard args.count >= 5, let d = Int(args[1]), let x = Double(args[2]), let y = Double(args[3]), let dy = Int32(args[4]) else { fail("scroll <display> <x> <y> <dy>") }
    requireTrust()
    post(CGEvent(mouseEventSource: source, mouseType: .mouseMoved, mouseCursorPosition: displayPoint(d, x, y), mouseButton: .left))
    post(CGEvent(scrollWheelEvent2Source: source, units: .pixel, wheelCount: 1, wheel1: dy, wheel2: 0, wheel3: 0))

case "type":
    guard args.count >= 2 else { fail("type <text>") }
    requireTrust()
    // Textul merge ca Unicode, deci și diacriticele, indiferent de tastatura activă.
    for ch in args.dropFirst().joined(separator: " ") {
        var units = Array(String(ch).utf16)
        let d = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true)
        let u = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false)
        d?.keyboardSetUnicodeString(stringLength: units.count, unicodeString: &units)
        u?.keyboardSetUnicodeString(stringLength: units.count, unicodeString: &units)
        post(d)
        post(u)
    }

case "key":
    guard args.count >= 2, let code = keyCodes[args[1].lowercased()] else { fail("tastă necunoscută") }
    requireTrust()
    var flags: CGEventFlags = []
    for m in (args.count > 2 ? args[2] : "").split(separator: ",") {
        switch m {
        case "cmd": flags.insert(.maskCommand)
        case "shift": flags.insert(.maskShift)
        case "alt": flags.insert(.maskAlternate)
        case "ctrl": flags.insert(.maskControl)
        default: break
        }
    }
    let d = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: true)
    let u = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: false)
    d?.flags = flags
    u?.flags = flags
    post(d)
    post(u)

default:
    fail("comandă necunoscută: \(command)")
}
