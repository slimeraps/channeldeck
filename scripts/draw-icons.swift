// Draws the app icon and the menu bar template images from the traced logo
// (resources/brand/mark.svg, made by scripts/trace-logo.swift) with CoreGraphics.
// Usage: swift scripts/draw-icons.swift <outdir>, then build the .icns with iconutil (see README).
import AppKit
import CoreGraphics

/// Brand colors (design/logo/brand-sheet.webp, with the mark recolored pink).
let BRAND_BG: UInt32 = 0x10151d
let BRAND_BG_LIGHT: UInt32 = 0x1a2230
let BRAND_MARK: UInt32 = 0xffa6c9

func color(_ hex: UInt32, _ a: CGFloat = 1) -> CGColor {
  CGColor(red: CGFloat((hex >> 16) & 0xff) / 255, green: CGFloat((hex >> 8) & 0xff) / 255,
          blue: CGFloat(hex & 0xff) / 255, alpha: a)
}

func save(_ ctx: CGContext, _ path: String) {
  let image = ctx.makeImage()!
  let rep = NSBitmapImageRep(cgImage: image)
  try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: path))
}

func makeContext(_ size: Int) -> CGContext {
  let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
                      space: CGColorSpace(name: CGColorSpace.sRGB)!,
                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  ctx.setAllowsAntialiasing(true)
  ctx.interpolationQuality = .high
  return ctx
}

/// The mark's outline from mark.svg: viewBox size and a path in SVG coordinates (y down).
/// The traced file only uses M, L and Z.
func loadMark() -> (size: CGSize, path: CGPath) {
  let svg = try! String(contentsOfFile: "resources/brand/mark.svg", encoding: .utf8)
  func attr(_ name: String) -> String {
    let start = svg.range(of: "\(name)=\"")!.upperBound
    return String(svg[start..<svg[start...].firstIndex(of: "\"")!])
  }
  let box = attr("viewBox").split(separator: " ").map { Double($0)! }
  let path = CGMutablePath()
  var command: Character = "M"
  var numbers: [Double] = []
  func flush() {
    guard numbers.count >= 2 else { return }
    let p = CGPoint(x: numbers[0], y: numbers[1])
    if command == "M" { path.move(to: p) } else { path.addLine(to: p) }
    numbers = []
  }
  var token = ""
  for ch in attr("d") + " " {
    if ch == "M" || ch == "L" || ch == "Z" || ch == " " {
      if !token.isEmpty { numbers.append(Double(token)!); token = "" }
      if ch != " " { flush(); if ch == "Z" { path.closeSubpath() } else { command = ch } }
    } else {
      token.append(ch)
    }
  }
  return (CGSize(width: box[2], height: box[3]), path)
}

let mark = loadMark()

/// Fills the mark so it fits `box` (centered), in the current fill color.
func drawMark(_ ctx: CGContext, in box: CGRect) {
  let scale = min(box.width / mark.size.width, box.height / mark.size.height)
  let w = mark.size.width * scale, h = mark.size.height * scale
  ctx.saveGState()
  // SVG is y-down; CoreGraphics is y-up.
  ctx.translateBy(x: box.midX - w / 2, y: box.midY + h / 2)
  ctx.scaleBy(x: scale, y: -scale)
  ctx.addPath(mark.path)
  ctx.fillPath(using: .evenOdd)
  ctx.restoreGState()
}

// ---- App icon (1024, macOS grid: 824 body, 100 inset) ------------------------------------
func appIcon(_ path: String) {
  let S: CGFloat = 1024
  let ctx = makeContext(Int(S))
  let body = CGRect(x: 100, y: 100, width: 824, height: 824)
  let bodyPath = CGPath(roundedRect: body, cornerWidth: 185, cornerHeight: 185, transform: nil)

  // Soft drop shadow, then the dark body with a faint top-to-bottom gradient.
  ctx.saveGState()
  ctx.setShadow(offset: CGSize(width: 0, height: -12), blur: 28, color: color(0x000000, 0.45))
  ctx.addPath(bodyPath); ctx.setFillColor(color(BRAND_BG)); ctx.fillPath()
  ctx.restoreGState()
  ctx.saveGState()
  ctx.addPath(bodyPath); ctx.clip()
  let bg = CGGradient(colorsSpace: nil, colors: [color(BRAND_BG_LIGHT), color(BRAND_BG)] as CFArray,
                      locations: [0, 1])!
  ctx.drawLinearGradient(bg, start: CGPoint(x: 512, y: 924), end: CGPoint(x: 512, y: 100), options: [])
  ctx.restoreGState()
  ctx.addPath(bodyPath); ctx.setStrokeColor(color(0xffffff, 0.08)); ctx.setLineWidth(4); ctx.strokePath()

  // The mark, about 56% of the body, like the brand sheet's app icon.
  ctx.setFillColor(color(BRAND_MARK))
  drawMark(ctx, in: CGRect(x: 512 - 240, y: 512 - 240, width: 480, height: 480))
  save(ctx, path)
}

// ---- Menu bar template (black on transparent; macOS tints it) ----------------------------
func trayIcon(_ path: String, px: Int) {
  let S = CGFloat(px)
  let ctx = makeContext(px)
  ctx.setFillColor(color(0x000000))
  // 16 of 18 points tall, centered: the mark's notch still reads at menu bar size.
  let inset = S / 18
  drawMark(ctx, in: CGRect(x: inset, y: inset, width: S - inset * 2, height: S - inset * 2))
  save(ctx, path)
}

let out = CommandLine.arguments[1]
appIcon("\(out)/icon-1024.png")
trayIcon("\(out)/trayTemplate.png", px: 18)
trayIcon("\(out)/trayTemplate@2x.png", px: 36)
print("ok")
