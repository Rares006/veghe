import SwiftUI

/// Legătura cu Mac-ul: adresa Tailscale și tokenul.
struct SettingsView: View {
    var onboarding = false
    @EnvironmentObject private var model: AppModel
    @State private var url = ""
    @State private var token = ""
    @State private var connecting = false
    @State private var error: String?
    @State private var scanning = false
    @FocusState private var focus: Field?

    private enum Field { case url, token }

    var body: some View {
        NavigationStack {
            Screen {
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        if onboarding {
                            onboardingHeader
                        } else {
                            ScreenHeader(title: "Setări", subtitle: model.connection?.url)
                        }

                        #if os(macOS)
                        Panel(title: "Împerechere cu iPhone-ul") { PairingView() }
                        #else
                        Button { scanning = true } label: {
                            Label("Scanează codul QR", systemImage: "qrcode.viewfinder")
                        }
                        .buttonStyle(.cfPrimary)
                        #endif

                        Panel(title: onboarding ? "Conectare manuală" : "Conexiune") {
                            FieldLabel(text: "adresa mac-ului")
                            TextField("http://100.x.y.z:8787", text: $url)
                                .autocorrectionDisabled()
                                #if os(iOS)
                                .keyboardType(.URL)
                                .textInputAutocapitalization(.never)
                                #endif
                                .focused($focus, equals: .url)
                                .cfField(focused: focus == .url)
                            FieldLabel(text: "token")
                            SecureField("din config.json", text: $token)
                                .focused($focus, equals: .token)
                                .cfField(focused: focus == .token)
                            Text("Adresa e IP-ul Tailscale al Mac-ului. Tokenul e în ~/Library/Application Support/ControlLaptop/config.json.")
                                .font(.system(size: 12))
                                .foregroundStyle(Theme.faint)
                            Button {
                                connect()
                            } label: {
                                if connecting {
                                    ProgressView().tint(.white)
                                } else {
                                    Label(model.connection == nil ? "Conectează" : "Salvează", systemImage: "link")
                                }
                            }
                            .buttonStyle(.cfPrimary)
                            .disabled(connecting || url.isEmpty || token.isEmpty)
                        }

                        if let error { ErrorBanner(message: error) }

                        if let status = model.status, !onboarding {
                            Panel(title: "Agent", trailing: AnyView(Badge(text: "v\(status.agent.version)"))) {
                                VStack(spacing: 8) {
                                    InfoRow(label: "Mac", value: status.system.host)
                                    InfoRow(label: "Pornit de", value: formatDuration(seconds: status.agent.uptimeSeconds))
                                }
                            }
                        }
                        if model.connection != nil && !onboarding {
                            Button { model.disconnect() } label: {
                                Label("Deconectează", systemImage: "xmark.circle")
                            }
                            .buttonStyle(.cfDanger)
                        }
                    }
                    .padding(16)
                }
            }
            .hiddenNavigationBar()
            #if os(iOS)
            .sheet(isPresented: $scanning) {
                QRScannerSheet { found in
                    url = found.url
                    token = found.token
                    connect()
                }
            }
            #endif
            .onAppear {
                url = model.connection?.url ?? ""
                token = model.connection?.token ?? ""
            }
        }
    }

    private var onboardingHeader: some View {
        VStack(alignment: .leading, spacing: 14) {
            Image(systemName: "laptopcomputer.and.iphone")
                .font(.system(size: 34, weight: .medium))
                .foregroundStyle(.white)
                .frame(width: 76, height: 76)
                .background(Theme.primaryGradient, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                .shadow(color: Theme.green.opacity(0.35), radius: 14, y: 6)
            Text("Veghe")
                .font(.system(size: 34, weight: .heavy))
                .tracking(-0.5)
                .foregroundStyle(Theme.titleGradient)
            Text("Pe Mac deschide Veghe → Setări, apoi aici apasă „Scanează codul QR”. Sau completează mai jos adresa și tokenul.")
                .font(.system(size: 15))
                .foregroundStyle(Theme.muted)
        }
        .padding(.top, 24)
        .padding(.bottom, 8)
    }

    private func connect() {
        connecting = true
        error = nil
        Task {
            do {
                try await model.connect(Connection(url: url, token: token))
            } catch {
                self.error = error.localizedDescription
            }
            connecting = false
        }
    }
}

struct RootView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        Group {
            if model.connection == nil {
                SettingsView(onboarding: true)
            } else {
                TabView(selection: $model.selectedTab) {
                    StatusView()
                        .tabItem { Label("Stare", systemImage: "gauge.with.dots.needle.67percent") }
                        .badge(model.waitingCount)
                        .tag(AppTab.status)
                    TasksView()
                        .tabItem { Label("Task-uri", systemImage: "list.bullet.rectangle.portrait") }
                        .tag(AppTab.tasks)
                    ScreenView()
                        .tabItem { Label("Ecran", systemImage: "display") }
                        .tag(AppTab.screen)
                    CamerasView()
                        .tabItem { Label("Camere", systemImage: "video") }
                        .tag(AppTab.cameras)
                    SettingsView()
                        .tabItem { Label("Setări", systemImage: "gearshape") }
                        .tag(AppTab.settings)
                }
                .tabBarStyle()
            }
        }
        .tint(Theme.green)
        .preferredColorScheme(.dark)
        .environment(\.locale, Locale(identifier: "ro_RO"))
    }
}

private extension View {
    @ViewBuilder
    func tabBarStyle() -> some View {
        #if os(iOS)
        self.toolbarBackground(Theme.panel, for: .tabBar)
            .toolbarBackground(.visible, for: .tabBar)
        #else
        self
        #endif
    }
}
