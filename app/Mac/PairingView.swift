import SwiftUI
import CoreImage.CIFilterBuiltins

/// Codul QR pe care îl scanezi cu camera iPhone-ului ca să-l legi de Mac.
struct PairingView: View {
    @EnvironmentObject private var model: AppModel
    @State private var urls: [String] = []
    @State private var choice = ""
    @State private var error: String?
    @State private var showToken = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let error {
                Text(error).foregroundStyle(.red)
            } else if urls.isEmpty {
                Label("Tailscale nu pare pornit pe Mac: agentul ascultă doar local. Pornește Tailscale și așteaptă câteva secunde.",
                      systemImage: "exclamationmark.triangle")
                    .foregroundStyle(.orange)
            } else {
                if urls.count > 1 {
                    Picker("Adresa", selection: $choice) {
                        ForEach(urls, id: \.self) { Text($0).tag($0) }
                    }
                }
                if let link = pairingLink, let qr = qrImage(link.absoluteString) {
                    HStack(alignment: .top, spacing: 16) {
                        Image(nsImage: qr)
                            .interpolation(.none)
                            .resizable()
                            .frame(width: 200, height: 200)
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Scanează cu camera iPhone-ului. Se deschide Veghe în Safari, deja conectat; apoi Partajează → Adaugă pe ecranul principal.")
                            LabeledContent("Adresa", value: choice)
                                .textSelection(.enabled)
                            if showToken, let token = model.connection?.token {
                                LabeledContent("Token", value: token).textSelection(.enabled)
                            } else {
                                Button("Arată tokenul") { showToken = true }
                            }
                        }
                        .font(.callout)
                    }
                }
            }
        }
        .task { await load() }
    }

    /// Aplicația web servită de agent, cu tokenul în fragment (#), care nu
    /// pleacă spre server și rămâne în scurtătura de pe ecranul principal.
    private var pairingLink: URL? {
        guard let token = model.connection?.token, !choice.isEmpty,
              let encoded = token.addingPercentEncoding(withAllowedCharacters: .alphanumerics)
        else { return nil }
        return URL(string: "\(choice)/#token=\(encoded)")
    }

    private func load() async {
        guard let client = model.client else { return }
        do {
            let r: PairingResponse = try await client.get("api/pairing")
            urls = r.urls
            if !urls.contains(choice) { choice = urls.first ?? "" }
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func qrImage(_ text: String) -> NSImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(text.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage else { return nil }
        let scaled = output.transformed(by: CGAffineTransform(scaleX: 8, y: 8))
        let rep = NSCIImageRep(ciImage: scaled)
        let image = NSImage(size: rep.size)
        image.addRepresentation(rep)
        return image
    }
}
