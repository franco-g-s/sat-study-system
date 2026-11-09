// Asserts that every row of qb_index.json points at the page it claims.
//
//   swift tools/verify_index.swift [data/qb_index.json]
//
// The check is exact, not a sample: each question's own page carries the string
// "Question ID: <qid>" in its text layer, so a page number that has drifted is
// arithmetic, not judgement. This is the check that was missing yesterday, when
// a figure-only page shifted every page number after it and the file named
// 310c87fe.png contained question 6585d841 -- while the overflow guard, the
// answer-leak check and the disjointness count all passed, because every one of
// them validated the pipeline and none asked whether an image matched its label.
//
// Exits non-zero on any mismatch and prints every one.
import Foundation
import PDFKit

let indexPath = CommandLine.arguments.count > 1
    ? CommandLine.arguments[1] : FileManager.default.currentDirectoryPath + "/data/qb_index.json"
let bankDir = FileManager.default.currentDirectoryPath + "/bank"  // run from the repo root

guard let raw = try? Data(contentsOf: URL(fileURLWithPath: indexPath)),
      let rows = (try? JSONSerialization.jsonObject(with: raw)) as? [[String: Any]] else {
    FileHandle.standardError.write("cannot read \(indexPath)\n".data(using: .utf8)!); exit(2)
}

var docs: [String: PDFDocument] = [:]
var checked = 0, bad = 0, skipped = 0

for row in rows {
    guard let qid = row["qid"] as? String,
          let file = row["file"] as? String,
          let pages = row["pages"] as? [Int], let page = pages.first else { skipped += 1; continue }
    let path = "\(bankDir)/\(file)"
    if docs[path] == nil { docs[path] = PDFDocument(url: URL(fileURLWithPath: path)) }
    guard let doc = docs[path], let pdfPage = doc.page(at: page - 1) else {
        print("MISSING  \(qid)  \(file) p\(page) does not exist")
        bad += 1; continue
    }
    // The text layer drops spaces at text-run boundaries, so the needle is matched
    // with all whitespace removed rather than collapsed.
    let text = (pdfPage.string ?? "").replacingOccurrences(
        of: "\\s+", with: "", options: .regularExpression)
    checked += 1
    if !text.contains("QuestionID:\(qid)") {
        // Report what IS on that page, so a shift is diagnosable at a glance.
        let found = text.range(of: "QuestionID:[0-9a-f]{8}", options: .regularExpression)
            .map { String(text[$0]).replacingOccurrences(of: "QuestionID:", with: "") } ?? "<none>"
        print("MISMATCH \(qid)  \(file) p\(page) actually holds \(found)")
        bad += 1
        continue
    }

    // Second half of the same guarantee: the region a question crop keeps must
    // hold that question and must NOT hold its answer. crop_y is the baseline of
    // the "Correct Answer:" line, and a crop_y belonging to a different page is
    // how the answer ended up visible on a practice page that shipped. Checking
    // the index rather than the PNG means it holds for every crop ever made from
    // this row, including ones that do not exist yet.
    guard let cropY = row["crop_y"] as? Double else { continue }
    let media = pdfPage.bounds(for: .mediaBox)
    let lineGuard = 12.0
    let above = CGRect(x: media.minX, y: CGFloat(cropY + lineGuard),
                       width: media.width, height: media.maxY - CGFloat(cropY + lineGuard))
    guard above.height > 1 else {
        print("EMPTY    \(qid)  \(file) p\(page) crop_y \(Int(cropY)) leaves no question above it")
        bad += 1; continue
    }
    let kept = (pdfPage.selection(for: above)?.string ?? "").replacingOccurrences(
        of: "\\s+", with: "", options: .regularExpression)
    if kept.contains("CorrectAnswer") {
        print("LEAK     \(qid)  \(file) p\(page) crop keeps the answer line")
        bad += 1
    } else if !kept.contains("QuestionID:\(qid)") {
        print("CROP     \(qid)  \(file) p\(page) crop region does not contain the question header")
        bad += 1
    }
}

print("checked \(checked), mismatched \(bad), skipped \(skipped)")
exit(bad > 0 ? 1 : 0)
