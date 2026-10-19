import SwiftUI
import VisionKit

/// Scanează codul QR din aplicația de Mac (Setări) direct din aplicație.
/// Camera iPhone-ului ar deschide link-ul în Safari, adică web app-ul.
struct QRScannerSheet: View {
    var onFound: (Connection) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var message = "Îndreaptă camera spre codul QR din Veghe pe Mac (fila Setări)."

    var body: some View {
        NavigationStack {
            ZStack(alignment: .bottom) {
                if DataScannerViewController.isSupported && DataScannerViewController.isAvailable {
                    QRScanner { text in
                        guard let url = URL(string: text), let c = Connection(pairingURL: url) else {
                            message = "Codul ăsta nu e de la Veghe."
                            return
                        }
                        onFound(c)
                        dismiss()
                    }
                    .ignoresSafeArea()
                } else {
                    Theme.background.ignoresSafeArea()
                    EmptyState(title: "Camera nu e disponibilă", symbol: "camera.fill",
                               message: "Permite accesul la cameră din Configurări → Veghe, sau completează manual adresa și tokenul.")
                }
                Text(message)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.center)
                    .padding(14)
                    .background(.black.opacity(0.6), in: RoundedRectangle(cornerRadius: 12))
                    .padding(24)
            }
            .navigationTitle("Scanează codul QR")
            .inlineTitle()
            .darkNavigationBar()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Renunță") { dismiss() }.tint(Theme.green)
                }
            }
        }
    }
}

private struct QRScanner: UIViewControllerRepresentable {
    var onCode: (String) -> Void

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let vc = DataScannerViewController(
            recognizedDataTypes: [.barcode(symbologies: [.qr])],
            qualityLevel: .balanced,
            isHighlightingEnabled: true
        )
        vc.delegate = context.coordinator
        try? vc.startScanning()
        return vc
    }

    func updateUIViewController(_ vc: DataScannerViewController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(onCode: onCode) }

    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        let onCode: (String) -> Void
        private var handled = false

        init(onCode: @escaping (String) -> Void) { self.onCode = onCode }

        func dataScanner(_ scanner: DataScannerViewController, didAdd items: [RecognizedItem], allItems: [RecognizedItem]) {
            guard !handled else { return }
            for item in items {
                if case .barcode(let code) = item, let text = code.payloadStringValue {
                    handled = text.contains("token")
                    onCode(text)
                    if handled { scanner.stopScanning() }
                    return
                }
            }
        }
    }
}
