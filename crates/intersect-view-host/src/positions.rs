//! UTF-16 positions ported from the existing host, with checked conversions.
use intersect_views::{Position, Range};
pub(crate) fn byte_position(text: &str, offset: usize) -> Position {
    let mut end = offset.min(text.len());
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    let before = &text[..end];
    let start = before.rfind('\n').map_or(0, |i| i + 1);
    Position {
        line: before.bytes().filter(|c| *c == b'\n').count(),
        character: before[start..].encode_utf16().count(),
    }
}
pub(crate) fn range(text: &str, start: usize, end: usize) -> Range {
    Range {
        start: byte_position(text, start),
        end: byte_position(text, end),
    }
}
pub(crate) fn position_byte(text: &str, position: &Position) -> Result<usize, String> {
    let mut start = 0;
    for _ in 0..position.line {
        start += text[start..].find('\n').ok_or("LSP line outside source")? + 1;
    }
    let line = text[start..].split('\n').next().map_or("", |s| s);
    let mut units = 0;
    for (offset, ch) in line.char_indices() {
        if units == position.character {
            return Ok(start + offset);
        }
        units += ch.len_utf16();
        if units > position.character {
            return Err("LSP position splits a Unicode scalar".into());
        }
    }
    if units == position.character {
        Ok(start + line.len())
    } else {
        Err("LSP character outside line".into())
    }
}
