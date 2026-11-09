// Contact sheet of the answer row and the footer from each question page.
//
//   swift tools/answer_strip.swift <outPrefix> <perSheet> <page.png> [page.png ...]
//   TOP_FRAC=0.05 BOT_FRAC=0.40 swift tools/answer_strip.swift ...   # solution pages
//
// Reviewing an R&W set means reading one circled letter off each of 25 pages. The
// letter lives in the top ~13% of the page and the question id lives in the
// footer; the 85% in between is the question, which has already been read once and
// is not what the review needs. Rendering all 25 in full to recover 25 letters is
// most of a review's tokens spent on whitespace.
//
// So each page contributes TWO strips -- its answer row and its footer -- stacked
// as one row. The footer carries "question N · qid · difficulty", which means the
// sheet LABELS ITSELF: a letter cannot drift away from the question it belongs to,
// because both are cropped from the same page in the same pass. That is the same
// rule as naming a crop after its page and crop line, and it exists for the same
// reason -- three bugs in this repo were an artifact that had quietly stopped
// matching its label.
import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

let args = CommandLine.arguments
guard args.count >= 4 else {
    FileHandle.standardError.write("usage: answer_strip.swift <outPrefix> <perSheet> <page.png>...\n".data(using: .utf8)!)
    exit(2)
}
let outPrefix = args[1]
let perSheet = Int(args[2]) ?? 12
let pages = Array(args.dropFirst(3))

// Defaults suit a QUESTION page: the answer circles sit in the top 13.5% and the
// footer in the bottom 4.5%. A SOLUTION page wants the other shape -- a thin
// heading and the whole tick grid -- so both are overridable from the environment
// rather than hard-coded twice.
let TOP_FRAC = Double(ProcessInfo.processInfo.environment["TOP_FRAC"] ?? "") ?? 0.135
let BOT_FRAC = Double(ProcessInfo.processInfo.environment["BOT_FRAC"] ?? "") ?? 0.045

func load(_ path: String) -> CGImage? {
    guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil) else { return nil }
    return CGImageSourceCreateImageAtIndex(src, 0, nil)
}

func strips(_ img: CGImage) -> [CGImage] {
    let w = img.width, h = img.height
    let topH = Int(Double(h) * TOP_FRAC)
    let botH = Int(Double(h) * BOT_FRAC)
    let top = img.cropping(to: CGRect(x: 0, y: 0, width: w, height: topH))
    let bot = img.cropping(to: CGRect(x: 0, y: h - botH, width: w, height: botH))
    return [top, bot].compactMap { $0 }
}

var sheetIndex = 0
var written = 0
for chunkStart in stride(from: 0, to: pages.count, by: perSheet) {
    let chunk = Array(pages[chunkStart..<min(chunkStart + perSheet, pages.count)])
    var rows: [[CGImage]] = []
    for p in chunk {
        guard let img = load(p) else {
            FileHandle.standardError.write("cannot read \(p)\n".data(using: .utf8)!); exit(1)
        }
        rows.append(strips(img))
    }
    let width = rows.compactMap { $0.first?.width }.max() ?? 0
    let gap = 10
    let totalH = rows.reduce(0) { $0 + $1.reduce(0) { $0 + $1.height } + gap }
    guard let ctx = CGContext(data: nil, width: width, height: totalH, bitsPerComponent: 8,
                              bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
                              bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { exit(1) }
    ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
    ctx.fill(CGRect(x: 0, y: 0, width: width, height: totalH))
    // CoreGraphics draws bottom-up; walk the rows from the bottom so the output
    // reads top-to-bottom in the same order the pages were given.
    var y = 0
    for row in rows.reversed() {
        for img in row.reversed() {
            ctx.draw(img, in: CGRect(x: 0, y: y, width: width, height: img.height))
            y += img.height
        }
        ctx.setFillColor(CGColor(red: 0.75, green: 0.75, blue: 0.75, alpha: 1))
        ctx.fill(CGRect(x: 0, y: y + gap / 2, width: width, height: 1))
        y += gap
    }
    guard let out = ctx.makeImage() else { exit(1) }
    let path = "\(outPrefix)-\(String(format: "%02d", sheetIndex)).png"
    guard let dest = CGImageDestinationCreateWithURL(
        URL(fileURLWithPath: path) as CFURL, UTType.png.identifier as CFString, 1, nil) else { exit(1) }
    CGImageDestinationAddImage(dest, out, nil)
    CGImageDestinationFinalize(dest)
    print("\(path)  \(out.width)x\(out.height)  \(chunk.count) pages")
    sheetIndex += 1
    written += chunk.count
}
FileHandle.standardError.write("\(written) pages -> \(sheetIndex) contact sheets\n".data(using: .utf8)!)
