// Index a question-bank PDF: one record per question, with REAL page numbers.
//
//   swift tools/index_export.swift "bank/Algebra.pdf" > data/idx-algebra.json
//
// Replaces a hand-rolled parser that inferred page order from the sequence of content
// streams containing text operators. Figure-only pages have no text, were skipped, and
// every page number after them shifted -- so a crop showed a different question than its
// filename claimed, and that reached the device. PDFKit knows the real page order, does
// its own ToUnicode decoding, and gives character bounds for the crop line.
import Foundation
import PDFKit

// Math first, then Reading and Writing (added 2026-09-01). Matched as a PREFIX of the
// metadata row, so no domain here may be a prefix of another -- none currently is.
let DOMAINS = ["Problem-Solving and Data Analysis", "Geometry and Trigonometry",
               "Advanced Math", "Algebra",
               "Standard English Conventions", "Information and Ideas",
               "Expression of Ideas", "Craft and Structure"]
// The section label sits in front of the domain and has to come off first. Longest
// first: a shorter one matching inside a longer would leave a fragment behind.
let SECTIONS = ["SAT Reading and Writing", "SAT Math"]
let DIFFS = ["Easy", "Medium", "Hard"]

let path = CommandLine.arguments[1]
guard let doc = PDFDocument(url: URL(fileURLWithPath: path)) else { exit(1) }
let file = (path as NSString).lastPathComponent

struct Q: Codable {
    var qid: String, domain: String, skill: String, difficulty: String
    var answer: String?, pages: [Int], crop_y: Double?, leak: Bool, file: String, text: String
}
var out: [Q] = []
var cur: Int? = nil

// One document-wide pass for the answer lines, keyed by page. Inside the page
// loop this would be quadratic over a 649-page PDF.
var answerLineByPage: [Int: Double] = [:]
for sel in doc.findString("Correct Answer", withOptions: []) {
    for page in sel.pages {
        let n = doc.index(for: page)
        answerLineByPage[n] = max(answerLineByPage[n] ?? -.infinity,
                                  Double(sel.bounds(for: page).minY))
    }
}

for i in 0..<doc.pageCount {
    guard let page = doc.page(at: i), let s = page.string else { continue }
    let lines = s.components(separatedBy: "\n").map { $0.trimmingCharacters(in: .whitespaces) }

    guard let idLine = lines.first(where: { $0.hasPrefix("Question ID:") }) else {
        if let c = cur { out[c].pages.append(i + 1) }   // rationale continuation
        continue
    }
    let qid = idLine.replacingOccurrences(of: "Question ID:", with: "").trimmingCharacters(in: .whitespaces)

    // The metadata row wraps across lines. Join everything between the header row and
    // "Question", then peel off the known domain and the trailing difficulty.
    var domain = "", skill = "", diff = ""
    if let h = lines.firstIndex(where: { $0.hasPrefix("Assessment") }),
       let q = lines.firstIndex(of: "Question"), q > h {
        var meta = lines[(h+1)..<q].joined(separator: " ")
        for sec in SECTIONS where meta.contains(sec) {
            meta = meta.replacingOccurrences(of: sec, with: "")
            break
        }
        meta = meta.trimmingCharacters(in: .whitespaces)
        meta = meta.replacingOccurrences(of: "  ", with: " ")
        for d in DOMAINS where meta.hasPrefix(d) {
            domain = d
            meta = String(meta.dropFirst(d.count)).trimmingCharacters(in: .whitespaces)
            break
        }
        // Difficulty is found WHEREVER it appears, not peeled off the suffix.
        //
        // The suffix version worked on all 1,925 maths rows and broke on five R&W
        // ones: `lines.firstIndex(of: "Question")` matches the exact trimmed line
        // "Question", and on those five pages that label is merged with the stem
        // that follows it. The join then ran to a LATER "Question", swallowing the
        // question text into the metadata row -- so the string did not end in a
        // difficulty, `diff` stayed empty, and the entire stem landed in `skill`.
        //
        // Everything after the difficulty token is page text that does not belong
        // to the metadata row, so it is dropped rather than kept.
        var cut: String.Index? = nil
        for f in DIFFS {
            if let r = meta.range(of: f), cut == nil || r.lowerBound < cut! {
                cut = r.lowerBound
                diff = f
            }
        }
        if let c = cut {
            skill = String(meta[meta.startIndex..<c]).trimmingCharacters(in: .whitespaces)
        } else {
            skill = meta
        }
    }

    // Crop line: y of "Correct Answer". PDF y grows upward, so the question sits above it.
    //
    // From SELECTION BOUNDS, never from characterBounds(at:) indexed by a string
    // offset. `page.string` and PDFKit's character array are not the same array,
    // so `s.distance(...)` addressed a different glyph and put the crop line
    // 29.25 pt too low on 149 pages -- keeping "Correct Answer: C" inside the
    // question crop. The old leak guard could not see it, because it tested the
    // wrong coordinate against itself.
    //
    // The topmost occurrence is the cut. Everything above it is kept, so no
    // occurrence can survive into the question crop by construction, and the
    // guard becomes a property of the calculation rather than a separate check
    // that can disagree with it.
    let cropY: Double? = answerLineByPage[i]
    // A page with no locatable answer line cannot be cropped safely, so it is not
    // offered at all rather than cropped at a guess.
    let leak = (cropY == nil)

    let answer = lines.first(where: { $0.hasPrefix("Correct Answer:") })?
        .replacingOccurrences(of: "Correct Answer:", with: "").trimmingCharacters(in: .whitespaces)
    let flat = s.replacingOccurrences(of: "\n", with: " ")
    out.append(Q(qid: qid, domain: domain, skill: skill, difficulty: diff, answer: answer,
                 pages: [i + 1], crop_y: cropY, leak: leak, file: file,
                 text: String(flat.prefix(1500))))
    cur = out.count - 1
}
FileHandle.standardOutput.write(try! JSONEncoder().encode(out))
let ok = out.filter { $0.crop_y != nil && !$0.leak && !$0.difficulty.isEmpty }.count
FileHandle.standardError.write(
  "\(file): \(doc.pageCount) pages -> \(out.count) questions, \(ok) usable\n".data(using: .utf8)!)
