import SwiftUI

/// Imaginile camerelor afișate în CamFlow (Chrome) pe Mac.
struct CamerasView: View {
    @EnvironmentObject private var model: AppModel
    @State private var frames: [LoadedFrame] = []
    @State private var takenAt: Date?
    @State private var loading = false
    @State private var error: String?
    @State private var live = false
    @State private var selected: LoadedFrame?

    struct LoadedFrame: Identifiable {
        let label: String
        let image: PlatformImage
        var id: String { label }
    }

    @State private var useCamflow = false

    private var camflowEnabled: Bool { model.status?.cameras.enabled ?? false }
    /// Camerele din CamFlow, doar dacă integrarea e pornită; altfel camera laptopului.
    private var camflowMode: Bool { camflowEnabled && useCamflow }
    private var bridgeConnected: Bool { model.status?.cameras.connected ?? false }
    private var sourceOnline: Bool { camflowMode ? bridgeConnected : !frames.isEmpty }

    var body: some View {
        NavigationStack {
            Screen {
                VStack(spacing: 0) {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 16) {
                            ScreenHeader(title: "Camere") {
                                HStack(spacing: 8) {
                                    StatusDot(color: sourceOnline ? Theme.green : Theme.gray, pulsing: live)
                                    Text(camflowMode ? (bridgeConnected ? "CamFlow" : "Deconectat") : "Laptop")
                                        .font(.system(size: 13, weight: .semibold))
                                        .foregroundStyle(sourceOnline ? Theme.text : Theme.muted)
                                }
                            }
                            if camflowEnabled {
                                SegmentedChoice(options: [(false, "Camera laptopului"), (true, "CamFlow")], selection: $useCamflow)
                                    .onChange(of: useCamflow) { _ in frames = []; error = nil; live = false }
                            }
                            if !camflowMode && frames.isEmpty && !loading {
                                Panel {
                                    EmptyState(title: "Camera laptopului", symbol: "video.fill",
                                               message: "Apasă butonul ca să vezi ce arată camera Mac-ului. Prima dată, pe Mac apare cererea de acces la cameră.")
                                }
                            } else if !camflowMode {
                                EmptyView()
                            } else if model.status != nil && !bridgeConnected {
                                Panel {
                                    EmptyState(title: "CamFlow nu e conectat", symbol: "video.slash.fill",
                                               message: "Deschide CamFlow pe Mac. Puntea se conectează singură când agentul rulează.")
                                }
                            } else if frames.isEmpty && !loading {
                                Panel {
                                    EmptyState(title: "Camere", symbol: "video.fill",
                                               message: "Apasă butonul ca să vezi ce arată camerele din CamFlow.")
                                }
                            }
                            LazyVGrid(columns: [GridItem(.adaptive(minimum: 300), spacing: 12)], spacing: 12) {
                                ForEach(frames) { frame in
                                    Button { selected = frame } label: { CameraCard(frame: frame, live: live) }
                                        .buttonStyle(.plain)
                                }
                            }
                        }
                        .padding(16)
                    }

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
                                Label(loading ? "Se încarcă…" : (camflowMode ? "Vezi camerele" : "Vezi camera"), systemImage: "video.fill")
                            }
                            .buttonStyle(.cfPrimary)
                            .disabled(loading)

                            LiveToggle(isOn: $live)
                        }
                        if let takenAt {
                            Text("Ultimul cadru: \(takenAt.clock)")
                                .font(.system(size: 12).monospacedDigit())
                                .foregroundStyle(Theme.faint)
                        }
                    }
                }
            }
            .hiddenNavigationBar()
            .sheet(item: $selected) { frame in
                NavigationStack {
                    Screen {
                        ZoomableImage(image: frame.image)
                    }
                    .navigationTitle(frame.label)
                    .inlineTitle()
                    .darkNavigationBar()
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) {
                            Button("Gata") { selected = nil }.tint(Theme.green)
                        }
                    }
                }
            }
            .task(id: live) {
                #if DEBUG
                if frames.isEmpty && ProcessInfo.processInfo.environment["CL_AUTOCAPTURE"] == "1" { await capture() }
                #endif
                guard live else { return }
                while !Task.isCancelled && live {
                    await capture()
                    try? await Task.sleep(nanoseconds: 2_000_000_000)
                }
            }
        }
    }

    private func capture() async {
        guard let client = model.client else { return }
        loading = true
        defer { loading = false }
        do {
            if !camflowMode {
                let data = try await client.raw("api/webcam", query: [URLQueryItem(name: "maxWidth", value: "1280")], timeout: 35)
                guard let img = PlatformImage(data: data) else { throw APIError(message: "Imaginea camerei nu se poate deschide.") }
                frames = [LoadedFrame(label: "Camera laptopului", image: img)]
                error = nil
                takenAt = Date()
                return
            }
            let r: CamerasResponse = try await client.get("api/cameras", timeout: 20)
            if let err = r.error { throw APIError(message: err) }
            frames = r.cameras.compactMap { cam in
                guard let data = cam.imageData, let img = PlatformImage(data: data) else { return nil }
                return LoadedFrame(label: cam.label, image: img)
            }
            if frames.isEmpty { error = "CamFlow e deschis, dar nicio cameră nu are imagine acum." } else { error = nil }
            takenAt = Date()
        } catch {
            self.error = error.localizedDescription
            live = false
        }
    }
}

private struct CameraCard: View {
    let frame: CamerasView.LoadedFrame
    let live: Bool

    var body: some View {
        Image(platformImage: frame.image)
            .resizable()
            .scaledToFit()
            .frame(maxWidth: .infinity)
            .background(Color.black)
            .overlay(alignment: .bottomLeading) {
                HStack(spacing: 6) {
                    if live { StatusDot(color: Theme.red, pulsing: true, size: 7) }
                    Text(frame.label)
                        .font(.system(size: 12, weight: .semibold))
                        .lineLimit(1)
                }
                .foregroundStyle(.white)
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(.black.opacity(0.55), in: RoundedRectangle(cornerRadius: 8))
                .padding(10)
            }
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Theme.border))
            .shadow(color: .black.opacity(0.4), radius: 16, y: 8)
    }
}
