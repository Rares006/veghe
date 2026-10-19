// cl-camera: o poză de la camera Mac-ului (FaceTime HD sau o cameră USB).
// Agentul îl compilează singur (swiftc) și îl apelează la fiecare cerere.
//
//   cl-camera list                         → JSON: [{"id": "...", "name": "..."}]
//   cl-camera snap <id|default> <out.jpg> <maxWidth>
//
// Agentul îl împachetează ca „Veghe Camera.app” și îl pornește cu `open`, ca
// macOS să-l trateze ca aplicație proprie: prima poză cere permisiunea Camera
// pentru „Veghe Camera”.

import AVFoundation
import AppKit
import CoreImage

// Pornit prin `open` (ca aplicație), nu avem stderr: erorile merg în <out>.err.
var errorFile: String?

func fail(_ message: String) -> Never {
    FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
    if let errorFile { try? message.write(toFile: errorFile, atomically: true, encoding: .utf8) }
    exit(1)
}

func cameras() -> [AVCaptureDevice] {
    AVCaptureDevice.DiscoverySession(
        deviceTypes: [.builtInWideAngleCamera, .externalUnknown],
        mediaType: .video,
        position: .unspecified
    ).devices
}

func ensureAccess() {
    switch AVCaptureDevice.authorizationStatus(for: .video) {
    case .authorized:
        return
    case .notDetermined:
        let done = DispatchSemaphore(value: 0)
        var granted = false
        AVCaptureDevice.requestAccess(for: .video) { ok in granted = ok; done.signal() }
        _ = done.wait(timeout: .now() + 120)
        if !granted { fail("denied") }
    default:
        fail("denied")
    }
}

/// Primește cadre și îl păstrează pe primul de după ce camera și-a reglat expunerea.
final class Grabber: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    let started = Date()
    let done = DispatchSemaphore(value: 0)
    var image: CIImage?

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard image == nil, Date().timeIntervalSince(started) > 0.8,
              let buffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        image = CIImage(cvPixelBuffer: buffer)
        done.signal()
    }
}

let args = Array(CommandLine.arguments.dropFirst())
switch args.first {
case "list":
    let list = cameras().map { ["id": $0.uniqueID, "name": $0.localizedName] }
    let data = try! JSONSerialization.data(withJSONObject: list)
    print(String(data: data, encoding: .utf8)!)

case "snap":
    if args.count >= 3 { errorFile = args[2] + ".err" }
    guard args.count >= 4, let maxWidth = Double(args[3]) else { fail("snap <id|default> <out.jpg> <maxWidth>") }
    ensureAccess()
    let all = cameras()
    let device = args[1] == "default"
        ? (AVCaptureDevice.default(for: .video) ?? all.first)
        : all.first(where: { $0.uniqueID == args[1] })
    guard let device else { fail("Camera nu există sau nu e conectată.") }

    let session = AVCaptureSession()
    session.sessionPreset = .high
    guard let input = try? AVCaptureDeviceInput(device: device), session.canAddInput(input) else {
        fail("Camera e ocupată sau nu poate fi deschisă.")
    }
    session.addInput(input)
    let output = AVCaptureVideoDataOutput()
    output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
    let grabber = Grabber()
    output.setSampleBufferDelegate(grabber, queue: DispatchQueue(label: "frames"))
    guard session.canAddOutput(output) else { fail("Nu pot citi imaginea camerei.") }
    session.addOutput(output)
    session.startRunning()
    let ok = grabber.done.wait(timeout: .now() + 10)
    session.stopRunning()
    guard ok == .success, var image = grabber.image else { fail("Camera n-a trimis nicio imagine la timp.") }

    if image.extent.width > maxWidth {
        let scale = maxWidth / image.extent.width
        image = image.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
    }
    let context = CIContext()
    guard let cg = context.createCGImage(image, from: image.extent),
          let jpeg = NSBitmapImageRep(cgImage: cg).representation(using: .jpeg, properties: [.compressionFactor: 0.75])
    else { fail("Nu pot salva imaginea.") }
    do { try jpeg.write(to: URL(fileURLWithPath: args[2])) } catch { fail("Nu pot scrie imaginea: \(error.localizedDescription)") }

default:
    fail("comandă necunoscută")
}
