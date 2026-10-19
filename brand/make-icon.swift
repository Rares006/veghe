// Desenează iconița Veghe (aceeași ca logo.svg) ca PNG 1024×1024.
// swift brand/make-icon.swift <ieșire.png>
import AppKit

let size: CGFloat = 1024
let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "veghe-1024.png"
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size), pixelsHigh: Int(size), bitsPerSample: 8,
                           samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
let ctx = NSGraphicsContext(bitmapImageRep: rep)!
NSGraphicsContext.current = ctx
let cg = ctx.cgContext
// Coordonatele SVG au originea sus; întoarcem axa Y.
cg.translateBy(x: 0, y: size)
cg.scaleBy(x: 1, y: -1)

func color(_ hex: UInt32, _ a: CGFloat = 1) -> CGColor {
    CGColor(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: a)
}
let space = CGColorSpaceCreateDeviceRGB()
let green = CGGradient(colorsSpace: space, colors: [color(0x10B981), color(0x059669), color(0x047857)] as CFArray, locations: [0, 0.5, 1])!
let dark = CGGradient(colorsSpace: space, colors: [color(0x1A1A1A), color(0x0A0A0A)] as CFArray, locations: [0, 1])!

// Fundal: pătrat rotunjit, degrade închis.
let bg = CGPath(roundedRect: CGRect(x: 0, y: 0, width: size, height: size), cornerWidth: 224, cornerHeight: 224, transform: nil)
cg.saveGState(); cg.addPath(bg); cg.clip()
cg.drawLinearGradient(dark, start: .zero, end: CGPoint(x: size, y: size), options: [])
cg.restoreGState()
cg.addPath(CGPath(roundedRect: CGRect(x: 6, y: 6, width: 1012, height: 1012), cornerWidth: 218, cornerHeight: 218, transform: nil))
cg.setStrokeColor(color(0xFFFFFF, 0.08)); cg.setLineWidth(4); cg.strokePath()

// Conturul ochiului, cu degradeul verde.
let eye = CGMutablePath()
eye.move(to: CGPoint(x: 172, y: 512))
eye.addQuadCurve(to: CGPoint(x: 852, y: 512), control: CGPoint(x: 512, y: 196))
eye.addQuadCurve(to: CGPoint(x: 172, y: 512), control: CGPoint(x: 512, y: 828))
eye.closeSubpath()
cg.saveGState()
cg.addPath(eye.copy(strokingWithWidth: 56, lineCap: .round, lineJoin: .round, miterLimit: 10))
cg.clip()
cg.drawLinearGradient(green, start: CGPoint(x: 172, y: 196), end: CGPoint(x: 852, y: 828), options: [])
cg.restoreGState()

// Irisul, pupila și reflexul.
cg.saveGState()
cg.addEllipse(in: CGRect(x: 362, y: 362, width: 300, height: 300)); cg.clip()
cg.drawLinearGradient(green, start: CGPoint(x: 362, y: 362), end: CGPoint(x: 662, y: 662), options: [])
cg.restoreGState()
cg.setFillColor(color(0x0A0A0A)); cg.fillEllipse(in: CGRect(x: 450, y: 450, width: 124, height: 124))
cg.setFillColor(color(0xFFFFFF, 0.92)); cg.fillEllipse(in: CGRect(x: 540, y: 430, width: 52, height: 52))

NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
print("Iconiță: \(out)")
