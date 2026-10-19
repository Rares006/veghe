import SwiftUI

/// Ce se vede acum pe ecranul Mac-ului, la o apăsare de buton.
struct ScreenView: View {
    @EnvironmentObject private var model: AppModel
    @State private var image: PlatformImage?
    @State private var takenAt: Date?
    @State private var loading = false
    @State private var error: String?
    @State private var live = false
    @State private var display = 1

    var body: some View {
        NavigationStack {
            Screen {
                VStack(spacing: 0) {
                    ScreenHeader(title: "Ecran", subtitle: takenAt.map { "Captură la \($0.clock)" }) {
                        if let image {
                            let img = Image(platformImage: image)
                            ShareLink(item: img, preview: SharePreview("Ecran Mac", image: img)) {
                                Image(systemName: "square.and.arrow.up")
                                    .font(.system(size: 16, weight: .semibold))
                                    .frame(width: 44, height: 44)
                            }
                            .buttonStyle(CFButtonStyle(kind: .secondary, compact: true))
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 12)

                    ZStack {
                        RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.black)
                        if let image {
                            ZoomableImage(image: image)
                                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                        } else if loading {
                            ProgressView().tint(Theme.green)
                        } else {
                            EmptyState(title: "Nicio captură", symbol: "display",
                                       message: "Apasă butonul ca să vezi ecranul laptopului.")
                        }
                    }
                    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Theme.border))
                    .padding(.horizontal, 16)
                    .padding(.bottom, 12)

                    BottomBar {
                        if let error {
                            Text(error)
                                .font(.system(size: 13))
                                .foregroundStyle(Theme.red)
                                .multilineTextAlignment(.center)
                        }
                        HStack(spacing: 10) {
                            Button {
                                Task { await capture() }
                            } label: {
                                Label(loading ? "Se încarcă…" : "Captură ecran", systemImage: "camera.viewfinder")
                            }
                            .buttonStyle(.cfPrimary)
                            .disabled(loading)

                            LiveToggle(isOn: $live)
                        }
                        HStack {
                            FieldLabel(text: "ecranul")
                            Spacer()
                            SegmentedChoice(options: [(1, "1"), (2, "2"), (3, "3")], selection: $display)
                                .frame(width: 150)
                        }
                    }
                }
            }
            .hiddenNavigationBar()
            .task(id: live) {
                #if DEBUG
                if image == nil && ProcessInfo.processInfo.environment["CL_AUTOCAPTURE"] == "1" { await capture() }
                #endif
                guard live else { return }
                while !Task.isCancelled && live {
                    await capture()
                    try? await Task.sleep(nanoseconds: 5_000_000_000)
                }
            }
        }
    }

    private func capture() async {
        guard let client = model.client else { return }
        loading = true
        defer { loading = false }
        do {
            let data = try await client.raw("api/screen", query: [URLQueryItem(name: "display", value: String(display))], timeout: 25)
            guard let img = PlatformImage(data: data) else { throw APIError(message: "Imaginea primită nu se poate deschide.") }
            image = img
            takenAt = Date()
            error = nil
        } catch {
            self.error = error.localizedDescription
            live = false
        }
    }
}
