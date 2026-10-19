// Desenează iconița aplicației (1024×1024) și o salvează ca PNG.
// swift app/tools/make_icon.swift <ieșire.png>
import AppKit

let size: CGFloat = 1024
let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "icon.png"

let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size), pixelsHigh: Int(size),
                           bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                           colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)

// Fundal: degrade închis, de la albastru-noapte la violet.
let gradient = NSGradient(colors: [
    NSColor(calibratedRed: 0.09, green: 0.11, blue: 0.20, alpha: 1),
    NSColor(calibratedRed: 0.20, green: 0.13, blue: 0.33, alpha: 1),
])!
gradient.draw(in: NSRect(x: 0, y: 0, width: size, height: size), angle: -60)

// Simbolul: laptop + telefon, alb, cu un punct portocaliu „live”.
let config = NSImage.SymbolConfiguration(pointSize: 470, weight: .medium)
if let symbol = NSImage(systemSymbolName: "laptopcomputer.and.iphone", accessibilityDescription: nil)?
    .withSymbolConfiguration(config) {
    let tinted = NSImage(size: symbol.size, flipped: false) { rect in
        symbol.draw(in: rect)
        NSColor.white.set()
        rect.fill(using: .sourceAtop)
        return true
    }
    let s = tinted.size
    tinted.draw(in: NSRect(x: (size - s.width) / 2, y: (size - s.height) / 2 - 20, width: s.width, height: s.height))
}
NSColor(calibratedRed: 1.0, green: 0.55, blue: 0.20, alpha: 1).setFill()
NSBezierPath(ovalIn: NSRect(x: size - 250, y: size - 250, width: 120, height: 120)).fill()

NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
print("Iconiță scrisă: \(out)")
