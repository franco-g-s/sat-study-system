// Recompute every row's crop line from PDFKit selection bounds.
//
//   swift tools/fix_cropy.swift > data/qb_index.new.json
//
// WHY THIS EXISTS. index_export.swift located the "Correct Answer" line by taking
// a Swift string offset into `page.string` and passing it to
// `page.characterBounds(at:)`. Those two do not index the same array -- PDFKit's
// character array is not `page.string` -- so the offset silently addressed a
// different glyph, and the crop line landed 29.25 pt too low on 149 pages. The
// question crop then kept the "Correct Answer: C" line and shipped the answer
// with the question.
//
// The `leak` guard did not catch it because the guard compared against the same
// wrong coordinate: it asked "is the answer above the line I computed?" using the
// line it had just computed wrongly. A check that shares its input with the thing
// it checks is not a check. This is the third instance today of the same shape --
// a green pipeline validating itself rather than its output.
//
// Selection bounds are authoritative: they agreed with the visible text on every
// page probed, including the ones the old method got right.
import Foundation
import PDFKit

let root = FileManager.default.currentDirectoryPath  // run from the repo root
guard let raw = try? Data(contentsOf: URL(fileURLWithPath: "\(root)/data/qb_index.json")),
      var rows = (try? JSONSerialization.jsonObject(with: raw)) as? [[String: Any]] else {
    FileHandle.standardError.write("cannot read index\n".data(using: .utf8)!); exit(2)
}

// pdf -> page number (1-based) -> the topmost "Correct Answer" on it.
var lineFor: [String: [Int: Double]] = [:]
for file in Set(rows.compactMap { $0["file"] as? String }) {
    let url = URL(fileURLWithPath: "\(root)/bank/\(file)")
    guard let doc = PDFDocument(url: url) else { continue }
    var byPage: [Int: Double] = [:]
    for sel in doc.findString("Correct Answer", withOptions: []) {
        for page in sel.pages {
            let n = doc.index(for: page) + 1
            let y = Double(sel.bounds(for: page).minY)
            // Topmost occurrence wins. Cutting there keeps everything above it,
            // so no occurrence can survive into the question crop.
            byPage[n] = max(byPage[n] ?? -.infinity, y)
        }
    }
    lineFor[file] = byPage
    FileHandle.standardError.write("\(file): answer lines on \(byPage.count) pages\n".data(using: .utf8)!)
}

var changed = 0, lost = 0, unchanged = 0
for i in rows.indices {
    guard let file = rows[i]["file"] as? String,
          let pages = rows[i]["pages"] as? [Int], let page = pages.first else { continue }
    let old = rows[i]["crop_y"] as? Double
    guard let fresh = lineFor[file]?[page] else {
        if old != nil { lost += 1 }
        rows[i]["crop_y"] = NSNull()
        rows[i]["leak"] = true          // no locatable answer line: refuse to crop it
        continue
    }
    rows[i]["crop_y"] = fresh
    rows[i]["leak"] = false             // true by construction now: nothing above the cut
    if let o = old, abs(o - fresh) < 0.01 { unchanged += 1 } else { changed += 1 }
}

FileHandle.standardError.write(
    "rows \(rows.count): \(unchanged) already right, \(changed) corrected, \(lost) with no answer line\n"
        .data(using: .utf8)!)
let out = try! JSONSerialization.data(withJSONObject: rows, options: [])
FileHandle.standardOutput.write(out)
