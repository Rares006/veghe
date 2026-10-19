import SwiftUI

@main
struct ControlLaptopMacApp: App {
    @StateObject private var model = AppModel()

    var body: some Scene {
        WindowGroup("Veghe", id: "main") {
            RootView()
                .environmentObject(model)
                .frame(minWidth: 760, minHeight: 560)
                .onAppear { model.startPolling() }
        }

        // Iconița din bara de meniu: câte sesiuni lucrează sau așteaptă aprobare.
        MenuBarExtra {
            MenuBarContent().environmentObject(model)
        } label: {
            Image(systemName: menuSymbol)
        }
    }

    private var menuSymbol: String {
        if !model.isOnline { return "laptopcomputer.slash" }
        if model.waitingCount > 0 { return "hand.raised.fill" }
        if model.workingCount > 0 { return "bolt.fill" }
        return "laptopcomputer"
    }
}

private struct MenuBarContent: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        if let status = model.status {
            let active = status.sessions.filter { $0.state != .idle }
            if active.isEmpty {
                Text("Nicio sesiune Claude nu lucrează")
            }
            ForEach(active) { s in
                Text("\(s.state == .working ? "⚡️" : "✋") \(s.title)")
            }
            Divider()
            Text("Coadă: \(status.queue.running) rulează, \(status.queue.queued) așteaptă")
        } else {
            Text(model.error ?? "Agentul nu răspunde")
        }
        Divider()
        Button("Deschide Veghe") {
            openWindow(id: "main")
            NSApp.activate(ignoringOtherApps: true)
        }
        Button("Ieșire") { NSApp.terminate(nil) }
            .keyboardShortcut("q")
    }
}
