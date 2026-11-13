// Draws build/icon.png (app icon) and resources/trayTemplate(@2x).png with CoreGraphics.
// Usage: swift scripts/draw-icons.swift <outdir>, then build the .icns with iconutil (see README).
import AppKit
import CoreGraphics

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

/// A card: rounded rect rotated around its center.
func card(_ ctx: CGContext, center: CGPoint, w: CGFloat, h: CGFloat, r: CGFloat, angle: CGFloat,
          fill: (CGContext, CGRect) -> Void) {
  ctx.saveGState()
  ctx.translateBy(x: center.x, y: center.y)
  ctx.rotate(by: angle * .pi / 180)
  let rect = CGRect(x: -w / 2, y: -h / 2, width: w, height: h)
  ctx.addPath(CGPath(roundedRect: rect, cornerWidth: r, cornerHeight: r, transform: nil))
  ctx.clip()
  fill(ctx, rect)
  ctx.restoreGState()
}

func triangle(_ ctx: CGContext, center: CGPoint, size: CGFloat) {
  // Play symbol, optically centered (shifted right a little).
  let h = size, w = size * 0.9
  let cx = center.x + w * 0.08
  ctx.beginPath()
  ctx.move(to: CGPoint(x: cx - w / 2, y: center.y - h / 2))
  ctx.addLine(to: CGPoint(x: cx + w / 2, y: center.y))
  ctx.addLine(to: CGPoint(x: cx - w / 2, y: center.y + h / 2))
  ctx.closePath()
  ctx.fillPath()
}

// ---- App icon (1024, macOS grid: 824 body, 100 inset) ------------------------------------
func appIcon(_ path: String) {
  let S: CGFloat = 1024
  let ctx = makeContext(Int(S))
  let body = CGRect(x: 100, y: 100, width: 824, height: 824)
  let bodyPath = CGPath(roundedRect: body, cornerWidth: 185, cornerHeight: 185, transform: nil)

  // Soft drop shadow, then the dark body with a gentle vertical gradient.
  ctx.saveGState()
  ctx.setShadow(offset: CGSize(width: 0, height: -12), blur: 28, color: color(0x000000, 0.45))
  ctx.addPath(bodyPath); ctx.setFillColor(color(0x111118)); ctx.fillPath()
  ctx.restoreGState()
  ctx.saveGState()
  ctx.addPath(bodyPath); ctx.clip()
  let bg = CGGradient(colorsSpace: nil, colors: [color(0x23233a), color(0x0b0b12)] as CFArray,
                      locations: [0, 1])!
  ctx.drawLinearGradient(bg, start: CGPoint(x: 512, y: 924), end: CGPoint(x: 512, y: 100), options: [])
  ctx.restoreGState()
  ctx.addPath(bodyPath); ctx.setStrokeColor(color(0xffffff, 0.08)); ctx.setLineWidth(4); ctx.strokePath()

  // The deck: three cards in channel colors, fanned.
  let c = CGPoint(x: 530, y: 452)
  let w: CGFloat = 470, h: CGFloat = 330, r: CGFloat = 56
  let back: [(UInt32, CGFloat, CGPoint)] = [
    (0xf97316, -14, CGPoint(x: c.x - 34, y: c.y + 92)),
    (0xec4899, -7, CGPoint(x: c.x - 14, y: c.y + 48))
  ]
  for (hex, angle, p) in back {
    ctx.saveGState()
    ctx.setShadow(offset: CGSize(width: 0, height: -8), blur: 18, color: color(0x000000, 0.35))
    card(ctx, center: p, w: w, h: h, r: r, angle: angle) { g, rect in
      g.setFillColor(color(hex)); g.fill(rect)
    }
    ctx.restoreGState()
  }
  // Front card: indigo → violet, with the play symbol.
  ctx.saveGState()
  ctx.setShadow(offset: CGSize(width: 0, height: -10), blur: 24, color: color(0x000000, 0.45))
  card(ctx, center: CGPoint(x: c.x + 10, y: c.y - 6), w: w, h: h, r: r, angle: 0) { g, rect in
    let grad = CGGradient(colorsSpace: nil, colors: [color(0x818cf8), color(0x6366f1), color(0x8b5cf6)] as CFArray,
                          locations: [0, 0.5, 1])!
    g.drawLinearGradient(grad, start: CGPoint(x: rect.minX, y: rect.maxY),
                         end: CGPoint(x: rect.maxX, y: rect.minY), options: [])
  }
  ctx.restoreGState()
  ctx.setFillColor(color(0xffffff))
  triangle(ctx, center: CGPoint(x: c.x + 10, y: c.y - 6), size: 150)
  save(ctx, path)
}

// ---- Menu bar template (black on transparent; macOS tints it) ----------------------------
func trayIcon(_ path: String, px: Int) {
  let S = CGFloat(px)
  let ctx = makeContext(px)
  ctx.scaleBy(x: S / 18, y: S / 18)  // draw in an 18-point grid
  ctx.setStrokeColor(color(0x000000)); ctx.setFillColor(color(0x000000))
  ctx.setLineWidth(1.4)
  // Back card outline (top), then the front card filled, with the play symbol knocked out.
  ctx.addPath(CGPath(roundedRect: CGRect(x: 5.0, y: 6.6, width: 11.8, height: 8.2), cornerWidth: 1.8, cornerHeight: 1.8, transform: nil))
  ctx.strokePath()
  let front = CGRect(x: 1.2, y: 2.6, width: 12.4, height: 8.6)
  ctx.addPath(CGPath(roundedRect: front, cornerWidth: 2, cornerHeight: 2, transform: nil))
  ctx.fillPath()
  ctx.setBlendMode(.clear)
  triangle(ctx, center: CGPoint(x: front.midX, y: front.midY), size: 4.6)
  save(ctx, path)
}

let out = CommandLine.arguments[1]
appIcon("\(out)/icon-1024.png")
trayIcon("\(out)/trayTemplate.png", px: 18)
trayIcon("\(out)/trayTemplate@2x.png", px: 36)
print("ok")
