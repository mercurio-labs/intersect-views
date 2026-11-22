//! Harness placement policy: make the Space's visible order a total chain.
//! Token edits retain comments and line endings; the host owns publication.
use intersect_model::core::frozen::Obj;
use intersect_view_host::{CommandContext, CommandError, source_patch};
use intersect_views::{Position, PrepareCommand, Range, SourcePatch};
use std::collections::BTreeSet;
fn fail(message: impl Into<String>) -> CommandError {
    CommandError::new("harness.lane", message)
}
fn name(o: Obj<'_>) -> Result<&str, CommandError> {
    o.feature("name")
        .and_then(|f| o.str(f))
        .ok_or_else(|| fail("Missing lane subject name"))
}
fn spelling(object: Obj<'_>) -> Result<String, CommandError> {
    Ok(name(object)?.into())
}
pub(super) fn prepare(
    context: &CommandContext<'_>,
    _command: &PrepareCommand,
) -> Result<Vec<SourcePatch>, CommandError> {
    let t = context
        .lane_target
        .as_ref()
        .ok_or_else(|| fail("Missing checked lane target"))?;
    let model = context
        .model
        .frozen()
        .ok_or_else(|| fail("Expected a harness model"))?;
    let object = |b: &intersect_views::Binding| {
        model
            .lookup(&b.element_id)
            .ok_or_else(|| fail("Lane subject disappeared"))
    };
    let step = object(&t.step.binding)?;
    let space = object(&t.container_binding)?;
    let lane = object(&t.lane.binding)?;
    if step.class_key() != "Step"
        || space.class_key() != "Space"
        || lane.class_key() != "Lane"
        || step.container().map(|(p, _)| p.id()) != Some(space.id())
        || lane.container().map(|(p, _)| p.id()) != Some(space.id())
    {
        return Err(fail("Placement must remain in one lexical Space"));
    }
    let mut order = t
        .ordered
        .iter()
        .copied()
        .filter(|b| b.key != t.step.binding.key)
        .collect::<Vec<_>>();
    let at = match t.before {
        Some(b) => order
            .iter()
            .position(|v| v.key == b.binding.key)
            .ok_or_else(|| fail("Insertion gap disappeared"))?,
        None => order.len(),
    };
    order.insert(at, &t.step.binding);
    let steps = order
        .iter()
        .map(|b| object(b))
        .collect::<Result<Vec<_>, _>>()?;
    let ids: BTreeSet<_> = steps.iter().map(|s| s.identity()).collect();
    if steps.len() != space.feature("steps").map_or(0, |f| space.refs(f).count()) {
        return Err(fail("Placement requires all Steps in the Space"));
    }
    let all_lanes = space
        .feature("lanes")
        .ok_or_else(|| fail("Missing Space lanes"))?;
    let lanes = space.refs(all_lanes).collect::<Vec<_>>();
    for (rank, s) in steps.iter().enumerate() {
        if s.class_key() != "Step"
            || s.container().map(|(p, _)| p.id()) != Some(space.id())
            || !context.sources.contains_key(s.resource())
            || s.resource() != space.resource()
        {
            return Err(fail("Every affected Step must be writable in this Space"));
        }
        let selected = s.id() == step.id();
        let end = if selected {
            t.end.map(|s| object(&s.binding)).transpose()?
        } else {
            s.feature("end").and_then(|f| s.refs(f).next())
        };
        if let Some(end) = end {
            let end_rank = steps
                .iter()
                .position(|s| s.id() == end.id())
                .ok_or_else(|| fail("Span end is outside this Space"))?;
            if end_rank <= rank {
                return Err(fail("Span must end after its start"));
            }
            let own = if selected {
                lane
            } else {
                s.feature("lane")
                    .and_then(|f| s.refs(f).next())
                    .ok_or_else(|| fail("Missing Step lane"))?
            };
            let mut coverage = vec![own.id()];
            if let Some(f) = s.feature("across") {
                for across in s.refs(f) {
                    if !coverage.contains(&across.id()) {
                        coverage.push(across.id());
                    }
                }
            }
            let mut bands = coverage
                .iter()
                .map(|id| {
                    lanes
                        .iter()
                        .position(|l| l.id() == *id)
                        .ok_or_else(|| fail("Span crosses a Space boundary"))
                })
                .collect::<Result<Vec<_>, _>>()?;
            bands.sort_unstable();
            if bands.windows(2).any(|p| p[1] != p[0] + 1) {
                return Err(fail("Span lanes must remain contiguous"));
            }
        }
    }
    if ids.len() != steps.len() {
        return Err(fail("Duplicate placement Step"));
    }
    let text = context
        .sources
        .get(space.resource())
        .ok_or_else(|| fail("Missing Space source"))?;
    let mut edits = Vec::<(usize, usize, String)>::new();
    for (rank, s) in steps.iter().enumerate() {
        let (start, end) = s.span();
        let fragment = text
            .get(start..end)
            .ok_or_else(|| fail("Invalid Step span"))?;
        let tokens = intersect_text::grammar::lex_with_limit(fragment, Some(200_000))
            .map_err(|(_, e)| fail(e))?;
        if tokens.len() < 5
            || tokens[0].text != "step"
            || tokens.last().is_none_or(|t| t.text != ";")
        {
            return Err(fail("Unsupported Step source shape"));
        }
        let name_end = |at: usize| -> Result<usize, CommandError> {
            let token = tokens
                .get(at)
                .ok_or_else(|| fail("Missing Step identifier"))?;
            let end = if token.text == "^" { at + 1 } else { at };
            tokens
                .get(end)
                .filter(|t| ![";", ","].contains(&t.text.as_str()))
                .ok_or_else(|| fail("Missing Step identifier"))?;
            Ok(end)
        };
        let in_token = name_end(1)? + 1;
        if tokens.get(in_token).is_none_or(|t| t.text != "in") {
            return Err(fail("Missing Step lane clause"));
        }
        let lane_first = in_token + 1;
        let lane_last = name_end(lane_first)?;
        let first = &tokens[lane_first];
        let last = &tokens[lane_last];
        let selected = s.id() == step.id();
        if selected {
            edits.push((
                start + first.start,
                start + last.start + last.text.len(),
                spelling(lane)?,
            ));
        }
        let mut cursor = lane_last + 1;
        // Parse clause positions, rather than matching keyword-looking names.
        for clause in ["after", "end", "across"] {
            if tokens.get(cursor).is_none_or(|t| t.text != clause) {
                continue;
            }
            let begin = cursor;
            cursor = name_end(cursor + 1)? + 1;
            if clause != "end" {
                while tokens.get(cursor).is_some_and(|t| t.text == ",") {
                    cursor = name_end(cursor + 1)? + 1;
                }
            }
            if clause == "after" || (selected && clause == "end") {
                for token in &tokens[begin..cursor] {
                    edits.push((
                        start + token.start,
                        start + token.start + token.text.len(),
                        String::new(),
                    ));
                }
            }
        }
        if cursor != tokens.len() - 1 {
            return Err(fail("Unsupported Step clauses"));
        }
        let mut clauses = String::new();
        if rank > 0 {
            clauses.push_str(&format!(" after {}", spelling(steps[rank - 1])?));
        }
        if selected && let Some(end) = t.end {
            clauses.push_str(&format!(" end {}", spelling(object(&end.binding)?)?));
        }
        let anchor = start + last.start + last.text.len();
        edits.push((anchor, anchor, clauses));
    }
    edits.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| b.1.cmp(&a.1)));
    let mut replacement = text.clone();
    for (start, end, value) in edits {
        replacement.replace_range(start..end, &value);
    }
    let last = text.rfind('\n').map_or(0, |i| i + 1);
    let range = Range {
        start: Position {
            line: 0,
            character: 0,
        },
        end: Position {
            line: text.bytes().filter(|b| *b == b'\n').count(),
            character: text[last..].encode_utf16().count(),
        },
    };
    Ok(vec![
        source_patch(space.resource(), text, range, replacement).map_err(fail)?,
    ])
}
