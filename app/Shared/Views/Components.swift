import SwiftUI

#if os(iOS)
import UIKit
typealias PlatformImage = UIImage
extension Image {
    init(platformImage: UIImage) { self.init(uiImage: platformImage) }
}
#else
import AppKit
typealias PlatformImage = NSImage
extension Image {
    init(platformImage: NSImage) { self.init(nsImage: platformImage) }
}
#endif

// MARK: - Tema Veghe
// Fundal #0a0a0a, panouri de sticlă,
// verde smarald #10b981 → #059669, butoane cu degrade și umbră verde.

enum Theme {
    static let background = Color(hex: 0x0A0A0A)
    static let panel = Color(hex: 0x141414)
    static let field = Color.white.opacity(0.05)
    static let border = Color.white.opacity(0.10)

    static let green = Color(hex: 0x10B981)
    static let greenDark = Color(hex: 0x059669)
    static let greenDeep = Color(hex: 0x047857)
    static let amber = Color(hex: 0xF59E0B)
    static let red = Color(hex: 0xEF4444)
    static let gray = Color(hex: 0x6B7280)

    static let title = Color(hex: 0xF3F4F6)
    static let text = Color(hex: 0xE5E7EB)
    static let muted = Color(hex: 0x9CA3AF)
    static let faint = Color(hex: 0x6B7280)

    static let primaryGradient = LinearGradient(colors: [green, greenDark], startPoint: .topLeading, endPoint: .bottomTrailing)
    static let titleGradient = LinearGradient(colors: [green, greenDark, greenDeep], startPoint: .topLeading, endPoint: .bottomTrailing)

    /// Curba „ease-out” a temei: cubic-bezier(0.16, 1, 0.3, 1).
    static func easeOut(_ duration: Double) -> Animation {
        .timingCurve(0.16, 1, 0.3, 1, duration: duration)
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(red: Double((hex >> 16) & 0xFF) / 255,
                  green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255)
    }
}

extension SessionState {
    var color: Color {
        switch self {
        case .working: return Theme.green
        case .waiting, .question: return Theme.amber
        case .idle: return Theme.gray
        }
    }
}

extension TaskStatus {
    var color: Color {
        switch self {
        case .queued: return Theme.amber
        case .running: return Theme.green
        case .done: return Theme.green
        case .failed: return Theme.red
        case .cancelled: return Theme.gray
        }
    }

    var symbol: String {
        switch self {
        case .queued: return "clock"
        case .running: return "bolt.fill"
        case .done: return "checkmark"
        case .failed: return "exclamationmark.triangle.fill"
        case .cancelled: return "stop.fill"
        }
    }
}

// MARK: - Panouri

/// Panoul de sticlă: colțuri de 16, margine fină, umbră.
struct Panel<Content: View>: View {
    var title: String?
    var trailing: AnyView?
    var padding: CGFloat = 18
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let title {
                HStack {
                    Text(title)
                        .font(.system(size: 16, weight: .semibold))
                        .tracking(-0.3)
                        .foregroundStyle(Theme.title)
                    Spacer()
                    trailing
                }
                .padding(.bottom, 10)
                .overlay(alignment: .bottom) { Rectangle().fill(Theme.border).frame(height: 1) }
            }
            content
        }
        .padding(padding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.panel.opacity(0.9), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Theme.border))
        .shadow(color: .black.opacity(0.4), radius: 16, y: 8)
    }
}

/// Fundalul fiecărui ecran.
struct Screen<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()
            content
        }
    }
}

/// Antetul ecranelor principale: titlu cu degrade verde.
struct ScreenHeader<Trailing: View>: View {
    let title: String
    var subtitle: String?
    @ViewBuilder var trailing: Trailing

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                Text(title)
                    .font(.system(size: 30, weight: .heavy))
                    .tracking(-0.5)
                    .foregroundStyle(Theme.titleGradient)
                if let subtitle {
                    Text(subtitle)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Theme.muted)
                        .lineLimit(1)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(Theme.green.opacity(0.10), in: RoundedRectangle(cornerRadius: 8))
                        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Theme.green.opacity(0.3)))
                }
            }
            Spacer()
            trailing
        }
        .padding(.top, 8)
    }
}

extension ScreenHeader where Trailing == EmptyView {
    init(title: String, subtitle: String? = nil) {
        self.init(title: title, subtitle: subtitle) { EmptyView() }
    }
}

// MARK: - Butoane

/// Butoanele temei: principal (degrade verde), secundar și de pericol.
struct CFButtonStyle: ButtonStyle {
    enum Kind { case primary, secondary, danger }
    var kind: Kind = .primary
    var compact = false
    var fullWidth = false

    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: compact ? 14 : 15, weight: .semibold))
            .tracking(-0.15)
            .padding(.horizontal, compact ? 14 : 22)
            .padding(.vertical, compact ? 9 : 14)
            .frame(maxWidth: fullWidth ? .infinity : nil)
            .foregroundStyle(foreground)
            .background(background, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(borderColor))
            .overlay(
                // Reflexul diagonal de la apăsare (.btn::before).
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(LinearGradient(colors: [.white.opacity(0.12), .clear], startPoint: .topLeading, endPoint: .center))
                    .opacity(configuration.isPressed ? 1 : 0)
            )
            .shadow(color: kind == .primary && isEnabled ? Theme.green.opacity(0.3) : .clear, radius: 8, y: 4)
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .opacity(isEnabled ? 1 : 0.4)
            .animation(Theme.easeOut(0.14), value: configuration.isPressed)
    }

    private var foreground: Color {
        switch kind {
        case .primary: return .white
        case .secondary: return Theme.text
        case .danger: return Theme.red
        }
    }

    private var background: AnyShapeStyle {
        switch kind {
        case .primary: return AnyShapeStyle(Theme.primaryGradient)
        case .secondary: return AnyShapeStyle(Color.white.opacity(0.08))
        case .danger: return AnyShapeStyle(Theme.red.opacity(0.2))
        }
    }

    private var borderColor: Color {
        switch kind {
        case .primary: return .clear
        case .secondary: return Theme.border
        case .danger: return Theme.red.opacity(0.3)
        }
    }
}

extension ButtonStyle where Self == CFButtonStyle {
    static var cfPrimary: CFButtonStyle { CFButtonStyle(kind: .primary, fullWidth: true) }
    static var cfSecondary: CFButtonStyle { CFButtonStyle(kind: .secondary, fullWidth: true) }
    static var cfDanger: CFButtonStyle { CFButtonStyle(kind: .danger, fullWidth: true) }
    static func cf(_ kind: CFButtonStyle.Kind, compact: Bool = true) -> CFButtonStyle {
        CFButtonStyle(kind: kind, compact: compact)
    }
}

/// Butonul rotund din antet (ex. „+”).
struct IconButton: View {
    let symbol: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 17, weight: .semibold))
                .frame(width: 44, height: 44)
        }
        .buttonStyle(CFButtonStyle(kind: .primary, compact: true))
        .clipShape(Circle())
    }
}

/// Comutatorul „Live” în stilul insignelor: verde când e pornit.
struct LiveToggle: View {
    @Binding var isOn: Bool

    var body: some View {
        Button {
            isOn.toggle()
        } label: {
            HStack(spacing: 8) {
                StatusDot(color: isOn ? Theme.green : Theme.gray, pulsing: isOn, size: 8)
                Text("Live")
            }
        }
        .buttonStyle(CFButtonStyle(kind: .secondary))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(isOn ? Theme.green.opacity(0.5) : .clear))
    }
}

/// Alegere între câteva opțiuni, cu cea selectată ca insignă verde.
struct SegmentedChoice<Value: Hashable>: View {
    let options: [(Value, String)]
    @Binding var selection: Value

    var body: some View {
        HStack(spacing: 6) {
            ForEach(options, id: \.0) { value, label in
                let selected = value == selection
                Button {
                    withAnimation(Theme.easeOut(0.2)) { selection = value }
                } label: {
                    Text(label)
                        .font(.system(size: 13, weight: .semibold))
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 9)
                        .foregroundStyle(selected ? Theme.green : Theme.muted)
                        .background(selected ? Theme.green.opacity(0.2) : Color.white.opacity(0.04),
                                    in: RoundedRectangle(cornerRadius: 10))
                        .overlay(RoundedRectangle(cornerRadius: 10)
                            .strokeBorder(selected ? Theme.green.opacity(0.4) : Theme.border))
                }
                .buttonStyle(.plain)
            }
        }
    }
}

// MARK: - Câmpuri

/// Câmp de text: fundal alb 5%, margine verde când e activ.
struct CFFieldModifier: ViewModifier {
    var focused = false

    func body(content: Content) -> some View {
        content
            .textFieldStyle(.plain)
            .font(.system(size: 15, weight: .medium))
            .foregroundStyle(Theme.text)
            .padding(.horizontal, 16)
            .padding(.vertical, 13)
            .background(focused ? Color.white.opacity(0.08) : Theme.field, in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(focused ? Theme.green : Theme.border))
            .shadow(color: focused ? Theme.green.opacity(0.15) : .clear, radius: 3)
            .animation(Theme.easeOut(0.2), value: focused)
    }
}

extension View {
    func cfField(focused: Bool = false) -> some View { modifier(CFFieldModifier(focused: focused)) }
}

struct FieldLabel: View {
    let text: String
    var body: some View {
        Text(text.uppercased())
            .font(.system(size: 11, weight: .semibold))
            .tracking(0.6)
            .foregroundStyle(Theme.faint)
    }
}

// MARK: - Stare

/// Punctul de stare cu inel care pulsează.
struct StatusDot: View {
    let color: Color
    var pulsing = false
    var size: CGFloat = 10

    @State private var animate = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: size, height: size)
            .background(
                Circle()
                    .fill(color)
                    .opacity(pulsing && !reduceMotion ? (animate ? 0 : 0.3) : 0)
                    .scaleEffect(animate ? 2.2 : 1.6)
            )
            .onAppear {
                guard pulsing, !reduceMotion else { return }
                withAnimation(.easeInOut(duration: 2).repeatForever(autoreverses: false)) { animate = true }
            }
    }
}

/// Insignă în culoarea stării.
struct Badge: View {
    let text: String
    var symbol: String?
    var color: Color = Theme.green
    var pulsing = false

    var body: some View {
        HStack(spacing: 6) {
            if pulsing {
                StatusDot(color: color, pulsing: true, size: 7)
            } else if let symbol {
                Image(systemName: symbol).font(.system(size: 10, weight: .bold))
            }
            Text(text)
        }
        .font(.system(size: 12, weight: .semibold))
        .foregroundStyle(color)
        .padding(.horizontal, 10)
        .padding(.vertical, 4)
        .background(color.opacity(0.2), in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(color.opacity(0.3)))
        .fixedSize()
    }
}

/// Mesaj pentru ecranele goale (ContentUnavailableView cere macOS 14).
struct EmptyState: View {
    let title: String
    let symbol: String
    var message: String = ""

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: symbol)
                .font(.system(size: 34, weight: .medium))
                .foregroundStyle(Theme.titleGradient)
                .frame(width: 72, height: 72)
                .background(Theme.green.opacity(0.1), in: Circle())
                .overlay(Circle().strokeBorder(Theme.green.opacity(0.25)))
            Text(title)
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(Theme.title)
            if !message.isEmpty {
                Text(message)
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.muted)
                    .multilineTextAlignment(.center)
            }
        }
        .padding(28)
        .frame(maxWidth: .infinity)
    }
}

struct ErrorBanner: View {
    let message: String

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "wifi.exclamationmark")
            Text(message)
        }
        .font(.system(size: 14, weight: .medium))
        .foregroundStyle(Theme.red)
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.red.opacity(0.15), in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.red.opacity(0.3)))
    }
}

/// Rând etichetă–valoare în panouri.
struct InfoRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack {
            Text(label).foregroundStyle(Theme.muted)
            Spacer()
            Text(value).foregroundStyle(Theme.text).multilineTextAlignment(.trailing)
        }
        .font(.system(size: 14))
    }
}

/// Bara de jos cu butoane (Ecran, Camere): sticlă închisă, margine sus.
struct BottomBar<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        VStack(spacing: 10) { content }
            .padding(16)
            .background(Theme.panel.opacity(0.95))
            .overlay(alignment: .top) { Rectangle().fill(Theme.border).frame(height: 1) }
    }
}

/// Imagine care se mărește cu două degete sau dublu-tap.
struct ZoomableImage: View {
    let image: PlatformImage
    @State private var scale: CGFloat = 1
    @GestureState private var pinch: CGFloat = 1

    var body: some View {
        GeometryReader { geo in
            ScrollView([.horizontal, .vertical], showsIndicators: false) {
                Image(platformImage: image)
                    .resizable()
                    .scaledToFit()
                    .frame(width: geo.size.width * scale * pinch)
                    .frame(minWidth: geo.size.width, minHeight: geo.size.height)
            }
            .gesture(
                MagnificationGesture()
                    .updating($pinch) { value, state, _ in state = value }
                    .onEnded { value in scale = min(max(scale * value, 1), 6) }
            )
            .onTapGesture(count: 2) {
                withAnimation(Theme.easeOut(0.3)) { scale = scale > 1 ? 1 : 2.5 }
            }
        }
    }
}

extension View {
    @ViewBuilder
    func inlineTitle() -> some View {
        #if os(iOS)
        self.navigationBarTitleDisplayMode(.inline)
        #else
        self
        #endif
    }

    /// Ecranele principale își desenează singure antetul.
    @ViewBuilder
    func hiddenNavigationBar() -> some View {
        #if os(iOS)
        self.toolbar(.hidden, for: .navigationBar)
        #else
        self
        #endif
    }

    /// Bara de navigare închisă.
    @ViewBuilder
    func darkNavigationBar() -> some View {
        #if os(iOS)
        self.toolbarBackground(Theme.background, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
        #else
        self
        #endif
    }
}

extension Date {
    /// Ora în format de 24 de ore, oricare ar fi setările telefonului.
    var clock: String { Date.clockFormatter.string(from: self) }

    private static let clockFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "ro_RO")
        f.dateFormat = "HH:mm:ss"
        return f
    }()
}

func formatDuration(seconds: Int) -> String {
    if seconds < 60 { return "\(seconds) s" }
    if seconds < 3600 { return "\(seconds / 60) min" }
    let h = seconds / 3600
    let m = (seconds % 3600) / 60
    return m > 0 ? "\(h) h \(m) min" : "\(h) h"
}
