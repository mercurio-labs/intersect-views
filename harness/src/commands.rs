//! Harness-owned source generation. Candidate analysis enforces language rules.
use intersect_view_host::{
    CommandContext, CommandError, Commands, ProjectObject, insert_member, source_patch,
};
use intersect_views::{Binding, Node, PrepareCommand, SourcePatch};
pub struct HarnessCommands;
fn fail(message: impl Into<String>) -> CommandError {
    CommandError::new("harness.command", message)
}
fn name<'a>(object: impl Into<ProjectObject<'a>>) -> Result<&'a str, CommandError> {
    let object = object.into();
    object
        .feature("name")
        .and_then(|f| object.str(f))
        .ok_or_else(|| fail("Element has no name"))
}
fn identifier(value: &str) -> Result<&str, CommandError> {
    let mut chars = value.chars();
    if !chars
        .next()
        .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
        || !chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
        || [
            "group", "trace", "space", "kind", "box", "pin", "field", "link", "from", "to", "part",
            "in", "out",
        ]
        .contains(&value)
    {
        return Err(fail("Name must be a non-keyword ASCII identifier"));
    }
    Ok(value)
}
fn endpoint<'a>(nodes: &'a [Node], id: &str) -> Option<&'a Binding> {
    for node in nodes {
        if node.id == id {
            return Some(&node.binding);
        }
        if let Some(p) = node.ports.iter().find(|p| p.id == id) {
            return Some(&p.binding);
        }
        if let Some(regions) = &node.regions {
            for region in &regions.items {
                if let Some(b) = endpoint(&region.children, id) {
                    return Some(b);
                }
            }
        }
        if let Some(b) = endpoint(&node.children, id) {
            return Some(b);
        }
    }
    None
}
fn end_path(
    context: &CommandContext<'_>,
    binding: &Binding,
    owner_key: &str,
) -> Result<(String, Vec<String>), CommandError> {
    let model = context.model;
    let object = model
        .lookup(&binding.element_id)
        .ok_or_else(|| fail("Endpoint disappeared"))?;
    let index = binding
        .context
        .iter()
        .rposition(|k| k == owner_key)
        .ok_or_else(|| fail("Endpoint is outside the selected owner's occurrence"))?;
    let prefix = binding.context[..index].to_vec();
    let rest = &binding.context[index + 1..];
    let text = match (object.class_key(), rest) {
        ("Box", []) => format!("part {}", identifier(name(object)?)?),
        ("Pin", []) => format!("pin {}", identifier(name(object)?)?),
        ("Pin", [part]) => {
            let part = context
                .keys
                .get(part)
                .and_then(|id| model.lookup(id))
                .ok_or_else(|| fail("Part disappeared"))?;
            if part.class_key() != "Box" {
                return Err(fail("Group endpoints require a member part"));
            }
            format!(
                "part {} pin {}",
                identifier(name(part)?)?,
                identifier(name(object)?)?
            )
        }
        ("Box", [group]) | ("Pin", [group, _]) => {
            let lookup = |key: &str| {
                context
                    .keys
                    .get(key)
                    .and_then(|id| model.lookup(id))
                    .ok_or_else(|| fail("Endpoint path disappeared"))
            };
            let group = lookup(group)?;
            if group.class_key() != "Group" {
                return Err(fail("Unsupported deeper endpoint path"));
            }
            let part = if object.class_key() == "Box" {
                object
            } else {
                lookup(&rest[1])?
            };
            if part.class_key() != "Box" || part.container().map(|o| o.id()) != Some(group.id()) {
                return Err(fail("Part is outside selected Group"));
            }
            format!(
                "group {} part {}{}",
                identifier(name(group)?)?,
                identifier(name(part)?)?,
                if object.class_key() == "Pin" {
                    format!(" pin {}", identifier(name(object)?)?)
                } else {
                    String::new()
                }
            )
        }
        _ => {
            return Err(fail(
                "Harness ends support a direct part, an owner pin, or a direct part's pin",
            ));
        }
    };
    Ok((text, prefix))
}
impl Commands for HarnessCommands {
    fn supports(&self, command: &str) -> bool {
        matches!(
            command,
            "harness.placeStep"
                | "harness.createBox"
                | "harness.createPin"
                | "harness.createLink"
                | "harness.createTrace"
                | "harness.deleteTrace"
                | "harness.createGroup"
                | "harness.setFieldValue"
        )
    }
    fn prepare(
        &self,
        context: &CommandContext<'_>,
        command: &PrepareCommand,
    ) -> Result<Vec<SourcePatch>, CommandError> {
        let model = context.model;
        if context.command == "harness.placeStep" {
            return crate::lane_commands::prepare(context, command);
        }
        if context.label_target.is_some() {
            return label_command(context, command);
        }
        if context.grid_target.is_some() {
            return grid_command(context, command);
        }
        let owner = context
            .keys
            .get(&command.owner_key)
            .and_then(|id| model.lookup(id))
            .ok_or_else(|| fail("Owner disappeared"))?;
        if owner.class_key() != "Box" {
            return Err(fail("Choose a Box owner"));
        }
        let requested = identifier(
            command
                .arguments
                .get("name")
                .ok_or_else(|| fail("Name is required"))?,
        )?;
        let declaration = match context.command {
            "harness.createGroup" => format!("group {requested} {{}}"),
            "harness.createBox" => {
                let kind = command
                    .arguments
                    .get("kind")
                    .filter(|s| !s.is_empty())
                    .map(|s| identifier(s))
                    .transpose()?;
                format!(
                    "box {requested}{} {{}}",
                    kind.map_or(String::new(), |k| format!(" : {k}"))
                )
            }
            "harness.createPin" => {
                let direction = command
                    .arguments
                    .get("direction")
                    .map_or("in", String::as_str);
                if !["in", "out"].contains(&direction) {
                    let mut e = fail("Pin direction must be in or out");
                    e.feature = Some("direction".into());
                    return Err(e);
                }
                format!("pin {requested} : {direction};")
            }
            "harness.createLink" => {
                let find = |arg: &str| {
                    command
                        .arguments
                        .get(arg)
                        .and_then(|id| {
                            context
                                .scene
                                .graph()
                                .ok()
                                .and_then(|s| endpoint(&s.nodes, id))
                        })
                        .ok_or_else(|| fail(format!("Choose a visible {arg} endpoint")))
                };
                let (source, a) = end_path(context, find("source")?, &command.owner_key)?;
                let (target, b) = end_path(context, find("target")?, &command.owner_key)?;
                if a != b {
                    return Err(fail(
                        "Connection endpoints belong to different owner occurrences",
                    ));
                }
                format!("link {requested} {{ from s ({source}) to t ({target}) }}")
            }
            _ => return Err(fail("Unsupported harness command")),
        };
        let text = context
            .sources
            .get(owner.resource())
            .ok_or_else(|| fail("Owner source is missing"))?;
        let (range, replacement) = insert_member(text, owner.span(), &declaration).map_err(fail)?;
        Ok(vec![
            source_patch(owner.resource(), text, range, replacement).map_err(fail)?,
        ])
    }
}

fn grid_command(
    context: &CommandContext<'_>,
    command: &PrepareCommand,
) -> Result<Vec<SourcePatch>, CommandError> {
    let model = context
        .model
        .frozen()
        .ok_or_else(|| fail("Expected a harness model"))?;
    let target = context
        .grid_target
        .as_ref()
        .ok_or_else(|| fail("Missing grid target"))?;
    let row = model
        .lookup(&target.row.binding.element_id)
        .ok_or_else(|| fail("Missing row"))?;
    let column = model
        .lookup(&target.column.binding.element_id)
        .ok_or_else(|| fail("Missing column"))?;
    if row.class_key() != "Box" || column.class_key() != "Box" {
        return Err(fail("Trace axes must be Boxes"));
    }
    let (space, _) = row.container().ok_or_else(|| fail("Missing Space"))?;
    if space.class_key() != "Space" || column.container().map(|(o, _)| o.id()) != Some(space.id()) {
        return Err(fail("Trace axes must belong to the same Space"));
    }
    let text = context
        .sources
        .get(space.resource())
        .ok_or_else(|| fail("Missing Space source"))?;
    let (range, replacement) = match context.command {
        "harness.createTrace" => {
            let requested = identifier(
                command
                    .arguments
                    .get("name")
                    .ok_or_else(|| fail("Name is required"))?,
            )?;
            insert_member(
                text,
                space.span(),
                &format!(
                    "trace {requested} from {} to {};",
                    identifier(name(row)?)?,
                    identifier(name(column)?)?
                ),
            )
            .map_err(fail)?
        }
        "harness.deleteTrace" => {
            let member = target.member.ok_or_else(|| fail("Choose a Trace member"))?;
            let trace = model
                .lookup(&member.binding.element_id)
                .ok_or_else(|| fail("Trace disappeared"))?;
            let end = |feature: &str| {
                trace
                    .feature(feature)
                    .and_then(|f| trace.refs(f).next())
                    .map(|o| o.id())
            };
            if trace.class_key() != "Trace"
                || trace.container().map(|(o, _)| o.id()) != Some(space.id())
                || end("source") != Some(row.id())
                || end("target") != Some(column.id())
                || trace.resource() != space.resource()
            {
                return Err(fail("Trace does not belong to the checked coordinate"));
            }
            (member.binding.range.clone(), String::new())
        }
        _ => return Err(fail("Unsupported grid command")),
    };
    Ok(vec![
        source_patch(space.resource(), text, range, replacement).map_err(fail)?,
    ])
}

fn label_command(
    context: &CommandContext<'_>,
    command: &PrepareCommand,
) -> Result<Vec<SourcePatch>, CommandError> {
    let model = context
        .model
        .frozen()
        .ok_or_else(|| fail("Expected a harness model"))?;
    let target = context
        .label_target
        .as_ref()
        .ok_or_else(|| fail("Missing label target"))?;
    let binding = target
        .part
        .binding
        .as_ref()
        .ok_or_else(|| fail("Unbound label"))?;
    let field = model
        .lookup(&binding.element_id)
        .ok_or_else(|| fail("Missing Field"))?;
    if context.command != "harness.setFieldValue"
        || field.class_key() != "Field"
        || target.slot != "row.label"
    {
        return Err(fail("Expected a Field value label"));
    }
    let value = command
        .arguments
        .get("value")
        .ok_or_else(|| fail("Value is required"))?;
    if value.is_empty()
        || !value.bytes().all(|b| b.is_ascii_digit())
        || value.parse::<i32>().is_err()
    {
        return Err(fail("Value must be a non-negative Int32 literal"));
    }
    let text = context
        .sources
        .get(field.resource())
        .ok_or_else(|| fail("Field source disappeared"))?;
    let (start, end) = field.span();
    let fragment = text
        .get(start..end)
        .ok_or_else(|| fail("Invalid Field span"))?;
    let tokens = intersect_text::grammar::lex_with_limit(fragment, Some(200_000))
        .map_err(|(_, e)| fail(e))?;
    let assignment = tokens
        .iter()
        .position(|t| t.text == "=")
        .ok_or_else(|| fail("Field has no value assignment"))?;
    let token = tokens
        .get(assignment + 1)
        .filter(|t| !t.text.is_empty() && t.text.bytes().all(|b| b.is_ascii_digit()))
        .ok_or_else(|| fail("Field value is not a numeric literal"))?;
    let pos = |at: usize| {
        let before = &text[..at];
        let line = before.bytes().filter(|b| *b == b'\n').count();
        let col = before.rfind('\n').map_or(0, |i| i + 1);
        intersect_views::Position {
            line,
            character: before[col..].encode_utf16().count(),
        }
    };
    let range = intersect_views::Range {
        start: pos(start + token.start),
        end: pos(start + token.start + token.text.len()),
    };
    Ok(vec![
        source_patch(field.resource(), text, range, value.clone()).map_err(fail)?,
    ])
}
