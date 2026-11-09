// Add `question_y` to every row of qb_index.json: the top of the actual question,
// below the bank's metadata table.
//
//   swift tools/add_question_y.swift > data/qb_index.new.json
//
// The bank prints a header on every page -- Question ID, then a table of
// Assessment / Test / Domain / Skill / Difficulty. On a sweep page that table
// primes the answer: it names the domain and skill, which is the recognition
// step being measured, and shows the difficulty, which the real test never does.
// So the question crop now starts below it, and the table moves to the solution
// page where it costs nothing.
//
// Located from selection bounds, never from a string offset into page.string --
// that is what put the crop line 29.25pt wrong on 149 pages.
//
// "Question" also occurs inside "Question ID:", higher up the page. The label we
// want is the topmost occurrence BELOW that one, so the header match is found
// first and used as a ceiling.
import Foundation
import PDFKit

let root = FileManager.default.currentDirectoryPath  // run from the repo root
// Input path is an argument, defaulting to the maths index, so the same tool can
// stamp the R&W index without a second copy of it drifting out of step.
let inPath = CommandLine.arguments.count > 1
    ? CommandLine.arguments[1] : "\(root)/data/qb_index.json"
guard let raw = try? Data(contentsOf: URL(fileURLWithPath: inPath)),
      var rows = (try? JSONSerialization.jsonObject(with: raw)) as? [[String: Any]] else {
    FileHandle.standardError.write("cannot read index\n".data(using: .utf8)!); exit(2)
}

var labelFor: [String: [Int: Double]] = [:]
for file in Set(rows.compactMap { $0["file"] as? String }) {
    guard let doc = PDFDocument(url: URL(fileURLWithPath: "\(root)/bank/\(file)")) else { continue }

    // Ceiling: the "Question ID:" line at the top of each page.
    var idLine: [Int: Double] = [:]
    for sel in doc.findString("Question ID", withOptions: []) {
        for page in sel.pages {
            let n = doc.index(for: page)
            idLine[n] = max(idLine[n] ?? -.infinity, Double(sel.bounds(for: page).minY))
        }
    }
    var byPage: [Int: Double] = [:]
    for sel in doc.findString("Question", withOptions: []) {
        for page in sel.pages {
            let n = doc.index(for: page)
            let y = Double(sel.bounds(for: page).minY)
            guard let ceiling = idLine[n], y < ceiling - 1 else { continue }  // skip the header itself
            byPage[n] = max(byPage[n] ?? -.infinity, y)                      // topmost below it
        }
    }
    labelFor[file] = byPage
    FileHandle.standardError.write("\(file): question labels on \(byPage.count) pages\n".data(using: .utf8)!)
}

var ok = 0, missing = 0, degenerate = 0
for i in rows.indices {
    guard let file = rows[i]["file"] as? String,
          let pages = rows[i]["pages"] as? [Int], let page = pages.first else { continue }
    guard let y = labelFor[file]?[page - 1] else { rows[i]["question_y"] = NSNull(); missing += 1; continue }
    // The band must be a band. If the label sits at or below the answer line the
    // page is not laid out the way we think, so decline rather than crop a sliver.
    if let cy = rows[i]["crop_y"] as? Double, y <= cy + 20 {
        rows[i]["question_y"] = NSNull(); degenerate += 1; continue
    }
    rows[i]["question_y"] = y
    ok += 1
}
FileHandle.standardError.write("rows \(rows.count): \(ok) located, \(missing) no label, \(degenerate) too close to the answer line\n".data(using: .utf8)!)
FileHandle.standardOutput.write(try! JSONSerialization.data(withJSONObject: rows, options: []))
