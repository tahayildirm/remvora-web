// Preserve every native clipboard representation in memory; never write or log user clipboard data.
import AppKit
import Foundation
let board = NSPasteboard.general
let saved = (board.pasteboardItems ?? []).map { item in
    item.types.compactMap { type -> (NSPasteboard.PasteboardType, Data)? in
        guard let data = item.data(forType: type) else { return nil }; return (type, data)
    }
}
board.clearContents()
board.setString("Remvora acceptance clipboard initial", forType: .string)
func restore() {
    // Respect an unrelated copy made by the user during the test.
    guard let text = board.string(forType: .string), text.hasPrefix("Remvora acceptance clipboard ") else { return }
    board.clearContents()
    let items = saved.map { representations in
        let item = NSPasteboardItem()
        for (type, data) in representations { item.setData(data, forType: type) }
        return item
    }
    if !items.isEmpty { board.writeObjects(items) }
}
let process = Process()
process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
process.arguments = ["python3", ".runtime/run-tls-acceptance.py"]
do {
    try process.run(); process.waitUntilExit(); restore(); exit(process.terminationStatus)
} catch { restore(); fputs("Acceptance runner failed\n", stderr); exit(1) }
