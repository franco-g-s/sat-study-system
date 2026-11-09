// Batch version of pdfcrop.swift: crops many pages in one process.
//
//   swift tools/crop_batch.swift < manifest.tsv
//
// Each line: <pdf>\t<page:1-based>\t<out.png>\t<scale>\t<above|below|full>\t<cropY>
// Existing outputs are skipped, so a rerun is cheap and interruption is safe.
//
// One process, not 1,155: `swift tools/pdfcrop.swift` costs ~1.3 s of compile and
// PDF-open per call, which is 25 minutes for the corpus. Opening each of the four
// bank PDFs once turns that into seconds.
import Foundation
import PDFKit
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

let lineGuard: CGFloat = 12   // matches pdfcrop.swift: keep the two in step

var docs: [String: PDFDocument] = [:]
var done = 0, skipped = 0, failed = 0

while let line = readLine(strippingNewline: true) {
    let f = line.components(separatedBy: "\t")
    guard f.count >= 6 else { continue }
    let pdfPath = f[0], outPath = f[2], mode = f[4]
    guard let pageNo = Int(f[1]), let scaleD = Double(f[3]), let cropYD = Double(f[5]) else { continue }
    let scale = CGFloat(scaleD), cropY = CGFloat(cropYD)

    if FileManager.default.fileExists(atPath: outPath) { skipped += 1; continue }

    if docs[pdfPath] == nil { docs[pdfPath] = PDFDocument(url: URL(fileURLWithPath: pdfPath)) }
    guard let doc = docs[pdfPath], let page = doc.page(at: pageNo - 1) else {
        FileHandle.standardError.write("FAIL no page \(pageNo) in \(pdfPath)\n".data(using: .utf8)!)
        failed += 1; continue
    }

    let media = page.bounds(for: .mediaBox)
    var box = media
    switch mode {
    case "above": box = CGRect(x: media.minX, y: cropY + lineGuard,
                               width: media.width, height: media.maxY - cropY - lineGuard)
    case "below": box = CGRect(x: media.minX, y: media.minY,
                               width: media.width, height: cropY + lineGuard - media.minY)
    default: break
    }
    guard box.height > 1 else {
        FileHandle.standardError.write("FAIL empty box \(outPath)\n".data(using: .utf8)!)
        failed += 1; continue
    }

    let w = Int((box.width * scale).rounded()), h = Int((box.height * scale).rounded())
    guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                              space: CGColorSpaceCreateDeviceGray(),
                              bitmapInfo: CGImageAlphaInfo.none.rawValue) else { failed += 1; continue }
    ctx.setFillColor(gray: 1, alpha: 1)
    ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
    ctx.scaleBy(x: scale, y: scale)
    ctx.translateBy(x: -box.minX, y: -box.minY)
    ctx.interpolationQuality = .high
    page.draw(with: .mediaBox, to: ctx)

    guard let img = ctx.makeImage(),
          let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: outPath) as CFURL,
                                                     UTType.png.identifier as CFString, 1, nil) else {
        failed += 1; continue
    }
    CGImageDestinationAddImage(dest, img, nil)
    CGImageDestinationFinalize(dest)
    done += 1
    if done % 100 == 0 { FileHandle.standardError.write("  \(done) cropped\n".data(using: .utf8)!) }
}
print("cropped \(done), skipped \(skipped), failed \(failed)")
exit(failed > 0 ? 1 : 0)
