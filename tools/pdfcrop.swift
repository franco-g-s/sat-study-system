// Render a page of a question-bank PDF to PNG, optionally cropped at a y-coordinate.
//
//   swift tools/pdfcrop.swift <pdf> <page:1-based> <out.png> <scale> [above|below|full|band] [cropY] [topY]
//
// `above` keeps everything above cropY — the question and its choices, with the
// answer and rationale removed. `below` keeps the rest. `full` ignores cropY.
// `band` keeps the strip between cropY and topY, with no guard applied to either:
// the caller has already decided where both edges go. It exists so a question can
// be cropped WITHOUT the bank's metadata header, which names the domain and the
// skill and shows the difficulty — all three of which prime an answer the sweep
// is trying to time, and none of which the real test shows.
// cropY is in PDF points from the bottom, which is what the text-matrix parse gives.
//
// PDFKit ships with macOS, so this needs nothing installed. Poppler, pypdf and
// ImageMagick are all absent on this machine and none is worth adding for one call.
import Foundation
import PDFKit
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

let a = CommandLine.arguments
guard a.count >= 5 else {
    FileHandle.standardError.write("usage: pdfcrop <pdf> <page> <out.png> <scale> [above|below|full] [cropY]\n".data(using: .utf8)!)
    exit(2)
}
let pdfPath = a[1], pageNo = Int(a[2])!, outPath = a[3], scale = CGFloat(Double(a[4])!)
let mode = a.count > 5 ? a[5] : "full"
let cropY = a.count > 6 ? CGFloat(Double(a[6])!) : 0
let topY = a.count > 7 ? CGFloat(Double(a[7])!) : 0

guard let doc = PDFDocument(url: URL(fileURLWithPath: pdfPath)),
      let page = doc.page(at: pageNo - 1) else {
    FileHandle.standardError.write("cannot open page \(pageNo)\n".data(using: .utf8)!); exit(1)
}

let media = page.bounds(for: .mediaBox)
var box = media
// cropY is the BASELINE of the "Correct Answer:" line. Text sits above its own
// baseline, so cutting at cropY leaves that line visible -- which it did, on the
// first test. The question crop must start above the line, and the solution crop
// must start below the previous line's descenders.
let lineGuard: CGFloat = 12   // one line of headroom, in points
// The bank's pages are letter-width and their text runs x 17..593 of 612, measured
// across ten pages of all four PDFs. Those margins are dead space that gets scaled
// down with everything else, so trimming them makes the question itself about 6%
// larger on the page for free. Generous by 2pt on each side so nothing clips.
let xLo: CGFloat = 15, xHi: CGFloat = 595
switch mode {
case "above": box = CGRect(x: media.minX, y: cropY + lineGuard,
                           width: media.width, height: media.maxY - cropY - lineGuard)
case "below": box = CGRect(x: media.minX, y: media.minY,
                           width: media.width, height: cropY + lineGuard - media.minY)
// Clamped to the page: callers pass a deliberately large topY to mean "up to the
// top edge" rather than having to know the media box, and an unclamped rect would
// render a tall band of nothing above the content.
case "band": box = CGRect(x: media.minX, y: max(cropY, media.minY),
                          width: media.width,
                          height: min(topY, media.maxY) - max(cropY, media.minY))
default: break
}

box = box.intersection(CGRect(x: xLo, y: media.minY, width: xHi - xLo, height: media.height))
let w = Int((box.width * scale).rounded()), h = Int((box.height * scale).rounded())
guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                          space: CGColorSpaceCreateDeviceGray(),
                          bitmapInfo: CGImageAlphaInfo.none.rawValue) else { exit(1) }
ctx.setFillColor(gray: 1, alpha: 1)
ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
ctx.scaleBy(x: scale, y: scale)
ctx.translateBy(x: -box.minX, y: -box.minY)
ctx.interpolationQuality = .high
page.draw(with: .mediaBox, to: ctx)

guard let img = ctx.makeImage(),
      let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: outPath) as CFURL,
                                                 UTType.png.identifier as CFString, 1, nil) else { exit(1) }
CGImageDestinationAddImage(dest, img, nil)
CGImageDestinationFinalize(dest)
print("\(outPath) \(w)x\(h)")
