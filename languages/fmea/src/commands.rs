//! Language-owned lexical edits, using the harness command pattern.
use intersect_view_host::{CommandContext, CommandError, Commands, source_patch};
use intersect_views::{Position, PrepareCommand, Range, SourcePatch};
pub struct FmeaCommands;
fn fail(message: impl Into<String>) -> CommandError {
    CommandError::new("fmea.command", message)
}
fn position(source: &str, at: usize) -> Position {
    let before = &source[..at];
    let start = before.rfind('\n').map_or(0, |i| i + 1);
    Position {
        line: before.bytes().filter(|b| *b == b'\n').count(),
        character: before[start..].encode_utf16().count(),
    }
}
impl Commands for FmeaCommands {
    fn supports(&self, id: &str) -> bool {
        matches!(id, "fmea.setRatings" | "fmea.updateAction")
    }
    fn prepare(
        &self,
        context: &CommandContext<'_>,
        command: &PrepareCommand,
    ) -> Result<Vec<SourcePatch>, CommandError> {
        let target = context
            .label_target
            .as_ref()
            .ok_or_else(|| fail("Choose a declared FMEA label action"))?;
        let binding = target
            .part
            .binding
            .as_ref()
            .ok_or_else(|| fail("Missing label subject"))?;
        let object = context
            .model
            .lookup(&binding.element_id)
            .ok_or_else(|| fail("Subject disappeared"))?;
        if target.slot != "node.subtitle"
            || object.resource() != binding.uri
            || command.owner_key != target.owner_binding.key
        {
            return Err(fail("FMEA target/source ownership mismatch"));
        }
        let text = context
            .sources
            .get(object.resource())
            .ok_or_else(|| fail("Missing subject source"))?;
        let (start, end) = object.span();
        let fragment = text
            .get(start..end)
            .ok_or_else(|| fail("Invalid subject span"))?;
        let tokens = intersect_text::grammar::lex_with_limit(fragment, Some(200_000))
            .map_err(|(_, e)| fail(e))?;
        let field = |name: &str| {
            tokens
                .iter()
                .position(|t| !t.quoted && t.text == name)
                .ok_or_else(|| fail(format!("Missing {name} clause")))
        };
        let argument = |name: &str| {
            command
                .arguments
                .get(name)
                .map(String::as_str)
                .ok_or_else(|| fail(format!("{name} is required")))
        };
        let mut edits: Vec<(usize, usize, String)> = vec![];
        match context.command {
            "fmea.setRatings" if object.class_key() == "FailureMode" => {
                let anchor = field("ratings")?;
                for (i, name) in ["severity", "occurrence", "detection"]
                    .into_iter()
                    .enumerate()
                {
                    let value = argument(name)?;
                    if value.is_empty()
                        || !value.bytes().all(|b| b.is_ascii_digit())
                        || value.parse::<i32>().is_err()
                    {
                        return Err(fail("Ratings require non-negative Int32 literals"));
                    }
                    let token = tokens
                        .get(anchor + i + 1)
                        .filter(|t| !t.quoted && t.text.bytes().all(|b| b.is_ascii_digit()))
                        .ok_or_else(|| fail("Rating is not a numeric literal"))?;
                    edits.push((token.start, token.end, value.into()));
                }
            }
            "fmea.updateAction" if object.class_key() == "Action" => {
                let status = argument("status")?;
                if !["planned", "done"].contains(&status) {
                    return Err(fail("Status must be planned or done"));
                }
                for name in ["owner", "status", "evidence"] {
                    let token = tokens
                        .get(field(name)? + 1)
                        .ok_or_else(|| fail("Missing action value"))?;
                    let value = argument(name)?;
                    if value.len() > 4096 {
                        return Err(fail("Action input exceeds 4096 UTF-8 bytes"));
                    }
                    if (name != "status") != token.quoted {
                        return Err(fail("Unexpected action token form"));
                    }
                    let lexical = if name == "status" {
                        value.to_owned()
                    } else {
                        serde_json::to_string(value).map_err(|e| fail(e.to_string()))?
                    };
                    edits.push((token.start, token.end, lexical));
                }
            }
            _ => return Err(fail("Unsupported FMEA command target")),
        }
        edits.sort_by_key(|e| e.0);
        let lo = edits
            .first()
            .map(|e| e.0)
            .ok_or_else(|| fail("No changes"))?;
        let hi = edits
            .last()
            .map(|e| e.1)
            .ok_or_else(|| fail("No changes"))?;
        let mut replacement = fragment
            .get(lo..hi)
            .ok_or_else(|| fail("Invalid token ranges"))?
            .to_owned();
        for (a, b, value) in edits.into_iter().rev() {
            replacement.replace_range(a - lo..b - lo, &value);
        }
        let range = Range {
            start: position(text, start + lo),
            end: position(text, start + hi),
        };
        Ok(vec![
            source_patch(object.resource(), text, range, replacement).map_err(fail)?,
        ])
    }
}
