// Traces the ChannelDeck logo artwork into vector outlines with Apple's Vision framework.
// Usage: swift scripts/trace-logo.swift <mark image> <wordmark image>
//   <mark image>:     the mark alone on a light background (colored pixels = mark)
//   <wordmark image>: the full logo on a light background (dark pixels = the "channeldeck" text)
// Writes resources/brand/mark.svg, resources/brand/wordmark.svg and
// src/renderer/src/components/brand/paths.ts (the same outlines for the app's UI).
// The outlines are polygons (M/L/Z only), dense enough to look smooth at icon sizes,
// so scripts/draw-icons.swift can read them without an SVG library.
import AppKit
import CoreGraphics
import Vision

struct Traced { let d: String; let width: Double; let height: Double }

func loadImage(_ path: String) -> CGImage {
  guard let image = NSImage(contentsOfFile: path),
        let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    fatalError("can't read \(path)")
  }
  return cg
}

/// Black where `keep` is true, white elsewhere: a clean two-tone image for Vision.
func mask(_ image: CGImage, keep: (Double, Double, Double) -> Bool) -> CGImage {
  let w = image.width, h = image.height
  var px = [UInt8](repeating: 0, count: w * h * 4)
  let ctx = CGContext(data: &px, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                      space: CGColorSpace(name: CGColorSpace.sRGB)!,
                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
  ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
  ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
  for i in stride(from: 0, to: px.count, by: 4) {
    let on = keep(Double(px[i]), Double(px[i + 1]), Double(px[i + 2]))
    let v: UInt8 = on ? 0 : 255
    px[i] = v; px[i + 1] = v; px[i + 2] = v; px[i + 3] = 255
  }
  return ctx.makeImage()!
}

/// Moving average around a closed outline (all of the logo's corners are rounded, so this only
/// irons out pixel noise).
func smooth(_ pts: [CGPoint], radius: Int, passes: Int) -> [CGPoint] {
  guard pts.count > radius * 2 + 1 else { return pts }
  var cur = pts
  for _ in 0..<passes {
    let n = cur.count
    cur = (0..<n).map { i in
      var x = 0.0, y = 0.0
      for k in -radius...radius {
        let p = cur[((i + k) % n + n) % n]
        x += Double(p.x); y += Double(p.y)
      }
      let c = Double(radius * 2 + 1)
      return CGPoint(x: x / c, y: y / c)
    }
  }
  return cur
}

/// Ramer–Douglas–Peucker on a closed outline (split at the point farthest from the first).
func simplify(_ pts: [CGPoint], epsilon: Double) -> [CGPoint] {
  guard pts.count > 4 else { return pts }
  func dist(_ p: CGPoint, _ a: CGPoint, _ b: CGPoint) -> Double {
    let dx = Double(b.x - a.x), dy = Double(b.y - a.y)
    let len = (dx * dx + dy * dy).squareRoot()
    if len == 0 { return Double(hypot(p.x - a.x, p.y - a.y)) }
    return abs(dy * Double(p.x - a.x) - dx * Double(p.y - a.y)) / len
  }
  func rdp(_ s: ArraySlice<CGPoint>) -> [CGPoint] {
    guard s.count > 2, let a = s.first, let b = s.last else { return Array(s) }
    var best = 0.0, index = s.startIndex
    for i in s.indices.dropFirst().dropLast() {
      let d = dist(s[i], a, b)
      if d > best { best = d; index = i }
    }
    if best <= epsilon { return [a, b] }
    return rdp(s[s.startIndex...index]).dropLast() + rdp(s[index...s.endIndex - 1])
  }
  var far = 0
  for i in pts.indices where hypot(pts[i].x - pts[0].x, pts[i].y - pts[0].y) > hypot(pts[far].x - pts[0].x, pts[far].y - pts[0].y) { far = i }
  let first = rdp(pts[0...far]), second = rdp((pts[far...] + [pts[0]])[...])
  return Array(first.dropLast() + second.dropLast())
}

func trace(_ image: CGImage, minArea: Double) -> Traced {
  let request = VNDetectContoursRequest()
  request.detectsDarkOnLight = true
  request.contrastAdjustment = 1
  request.maximumImageDimension = max(image.width, image.height)
  try! VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
  let observation = request.results!.first!
  let W = Double(image.width), H = Double(image.height)

  var polys: [[CGPoint]] = []
  func visit(_ contour: VNContour) {
    let raw = contour.normalizedPoints.map { CGPoint(x: Double($0.x) * W, y: (1 - Double($0.y)) * H) }
    // The artwork is a slightly noisy raster: smooth the pixel-level outline, then drop
    // points that don't change its shape by more than a fraction of a pixel.
    let pts = simplify(smooth(raw, radius: 4, passes: 3), epsilon: 0.35)
    // Shoelace area: drops specks and noise from the AI-made artwork.
    var area = 0.0
    for i in 0..<pts.count {
      let a = pts[i], b = pts[(i + 1) % pts.count]
      area += Double(a.x * b.y - b.x * a.y)
    }
    if abs(area) / 2 >= minArea { polys.append(pts) }
    for child in contour.childContours { visit(child) }
  }
  for top in observation.topLevelContours { visit(top) }

  // Crop to the outlines' bounds, then write the path relative to that box.
  let all = polys.flatMap { $0 }
  let minX = all.map(\.x).min()!, minY = all.map(\.y).min()!
  let maxX = all.map(\.x).max()!, maxY = all.map(\.y).max()!
  func f(_ v: CGFloat) -> String { String(format: "%.1f", Double(v)) }
  let d = polys.map { pts in
    "M" + pts.map { "\(f($0.x - minX)) \(f($0.y - minY))" }.joined(separator: "L") + "Z"
  }.joined()
  return Traced(d: d, width: Double(maxX - minX), height: Double(maxY - minY))
}

func svg(_ t: Traced, fill: String) -> String {
  let w = String(format: "%.1f", t.width), h = String(format: "%.1f", t.height)
  return """
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 \(w) \(h)" width="\(w)" height="\(h)">
    <path fill="\(fill)" fill-rule="evenodd" d="\(t.d)"/>
  </svg>

  """
}

let args = CommandLine.arguments
guard args.count == 3 else { fatalError("usage: swift scripts/trace-logo.swift <mark> <wordmark>") }

// The mark: any saturated (non-gray) pixel. The wordmark: dark, unsaturated pixels.
let mark = trace(mask(loadImage(args[1])) { r, g, b in max(r, g, b) - min(r, g, b) > 60 },
                 minArea: 2000)
let word = trace(mask(loadImage(args[2])) { r, g, b in
  max(r, g, b) < 110 && max(r, g, b) - min(r, g, b) < 40
}, minArea: 150)

let fm = FileManager.default
try! fm.createDirectory(atPath: "resources/brand", withIntermediateDirectories: true)
try! fm.createDirectory(atPath: "src/renderer/src/components/brand", withIntermediateDirectories: true)
try! svg(mark, fill: "#ffa6c9").write(toFile: "resources/brand/mark.svg", atomically: true, encoding: .utf8)
try! svg(word, fill: "#f5f7fa").write(toFile: "resources/brand/wordmark.svg", atomically: true, encoding: .utf8)

func n(_ v: Double) -> String { String(format: "%.1f", v) }
let ts = """
// Generated by scripts/trace-logo.swift from the logo artwork. Don't edit by hand.

/** The ChannelDeck mark (the two cards with the play notch). */
export const MARK = {
  width: \(n(mark.width)),
  height: \(n(mark.height)),
  d: '\(mark.d)'
} as const

/** The "channeldeck" wordmark (letters with counters; fill-rule evenodd). */
export const WORDMARK = {
  width: \(n(word.width)),
  height: \(n(word.height)),
  d: '\(word.d)'
} as const

"""
try! ts.write(toFile: "src/renderer/src/components/brand/paths.ts", atomically: true, encoding: .utf8)
print("mark \(n(mark.width))x\(n(mark.height)), \(mark.d.count) chars; wordmark \(n(word.width))x\(n(word.height)), \(word.d.count) chars")
