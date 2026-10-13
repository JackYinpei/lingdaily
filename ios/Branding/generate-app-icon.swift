import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

// Run from any directory: swift ios/Branding/generate-app-icon.swift
// Palette comes from Brand.swift; geometry is shared by the SVG and all icon appearances.
let iosRoot = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
let brand = try String(contentsOf: iosRoot.appendingPathComponent("LingDaily/LingDaily/DesignSystem/Brand.swift"), encoding: .utf8)
let iconRoot = iosRoot.appendingPathComponent("LingDaily/LingDaily/Assets.xcassets/AppIcon.appiconset")

func palette(_ token: String, dark: Bool) throws -> String {
    let regex = try NSRegularExpression(pattern: "static let \(token) = adaptive\\(0x([0-9A-Fa-f]{6}), 0x([0-9A-Fa-f]{6})\\)")
    guard let match = regex.firstMatch(in: brand, range: NSRange(brand.startIndex..., in: brand)),
          let range = Range(match.range(at: dark ? 2 : 1), in: brand) else {
        fatalError("Missing Brand palette token: \(token)")
    }
    return "#" + brand[range]
}

func color(_ hex: String) -> CGColor {
    let rgb = UInt32(hex.dropFirst(), radix: 16)!
    return CGColor(colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!, components: [
        CGFloat((rgb >> 16) & 255) / 255, CGFloat((rgb >> 8) & 255) / 255,
        CGFloat(rgb & 255) / 255, 1
    ])!
}

enum Segment {
    case move(Double, Double), line(Double, Double)
    case curve(Double, Double, Double, Double, Double, Double)
    case close
}

let rear: [Segment] = [
    .move(264, 210), .line(550, 210), .curve(601, 210, 642, 251, 642, 302),
    .line(642, 472), .curve(642, 523, 601, 564, 550, 564),
    .line(354, 564), .line(258, 640), .line(258, 564),
    .curve(209, 561, 172, 523, 172, 472), .line(172, 302),
    .curve(172, 251, 213, 210, 264, 210), .close
]
let front: [Segment] = [
    .move(474, 426), .line(760, 426), .curve(811, 426, 852, 467, 852, 518),
    .line(852, 688), .curve(852, 739, 818, 777, 770, 780),
    .line(770, 852), .line(674, 780), .line(474, 780),
    .curve(423, 780, 382, 739, 382, 688), .line(382, 518),
    .curve(382, 467, 423, 426, 474, 426), .close
]

func path(_ segments: [Segment]) -> CGPath {
    let result = CGMutablePath()
    for segment in segments {
        switch segment {
        case let .move(x, y): result.move(to: CGPoint(x: x, y: y))
        case let .line(x, y): result.addLine(to: CGPoint(x: x, y: y))
        case let .curve(a, b, c, d, x, y):
            result.addCurve(to: CGPoint(x: x, y: y), control1: CGPoint(x: a, y: b), control2: CGPoint(x: c, y: d))
        case .close: result.closeSubpath()
        }
    }
    return result
}

func svgPath(_ segments: [Segment]) -> String {
    segments.map { segment in
        switch segment {
        case let .move(x, y): return "M\(x) \(y)"
        case let .line(x, y): return "L\(x) \(y)"
        case let .curve(a, b, c, d, x, y): return "C\(a) \(b) \(c) \(d) \(x) \(y)"
        case .close: return "Z"
        }
    }.joined(separator: " ")
}

for appearance in ["Light", "Dark", "Tinted"] {
    let tinted = appearance == "Tinted"
    let dark = appearance == "Dark"
    let background = try tinted ? "#000000" : palette("page", dark: dark)
    let back = try tinted ? "#888888" : palette("ink", dark: dark)
    let foreground = try tinted ? "#FFFFFF" : palette("accent", dark: dark)
    let text = try tinted ? "#000000" : palette("onInk", dark: dark)
    let context = CGContext(data: nil, width: 1024, height: 1024, bitsPerComponent: 8, bytesPerRow: 0,
                            space: CGColorSpace(name: CGColorSpace.sRGB)!,
                            bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
    context.translateBy(x: 0, y: 1024)
    context.scaleBy(x: 1, y: -1)
    context.setFillColor(color(background))
    context.fill(CGRect(x: 0, y: 0, width: 1024, height: 1024))
    context.setFillColor(color(back))
    context.addPath(path(rear)); context.fillPath()
    context.setFillColor(color(foreground))
    context.setStrokeColor(color(background)); context.setLineWidth(22); context.setLineJoin(.round)
    context.addPath(path(front)); context.drawPath(using: .fillStroke)
    context.setStrokeColor(color(text)); context.setLineWidth(30); context.setLineCap(.round)
    context.move(to: CGPoint(x: 486, y: 550)); context.addLine(to: CGPoint(x: 744, y: 550))
    context.move(to: CGPoint(x: 486, y: 640)); context.addLine(to: CGPoint(x: 670, y: 640))
    context.strokePath()
    let destination = CGImageDestinationCreateWithURL(iconRoot.appendingPathComponent("AppIcon-\(appearance).png") as CFURL,
                                                     UTType.png.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(destination, context.makeImage()!, nil)
    guard CGImageDestinationFinalize(destination) else { fatalError("Could not write AppIcon-\(appearance).png") }

    if appearance == "Light" {
        let svg = """
        <svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
          <title>LingDaily — two people in conversation</title>
          <rect width="1024" height="1024" fill="\(background)"/>
          <path d="\(svgPath(rear))" fill="\(back)"/>
          <path d="\(svgPath(front))" fill="\(foreground)" stroke="\(background)" stroke-width="22" stroke-linejoin="round"/>
          <path d="M486 550H744 M486 640H670" fill="none" stroke="\(text)" stroke-width="30" stroke-linecap="round"/>
        </svg>
        """
        try svg.write(to: iosRoot.appendingPathComponent("Branding/Logo.svg"), atomically: true, encoding: .utf8)
    }
}
