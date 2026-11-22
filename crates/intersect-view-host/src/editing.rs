//! Isolated prepare/commit transaction ported from the KerML host. No I/O.
use crate::{
    CommandContext, CommandError, Host, ProjectRequest, Snapshot, Source, identity, positions,
};
use intersect_views::{MAX_WIRE_INTEGER, PrepareCommand, PreparedEdit, Range, SourcePatch};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
pub(crate) struct Candidate {
    pub revision: u64,
    pub snapshot: Option<Snapshot>,
    pub sources: BTreeMap<String, String>,
    pub reference_sources: BTreeMap<String, String>,
    pub project_nodes_only: bool,
    pub editable: BTreeSet<String>,
    pub navigation: Vec<intersect_text::Reference>,
    pub analysis: Value,
    pub rejection: Option<CommandError>,
}
pub(crate) struct Pending {
    pub token: String,
    pub base_revision: u64,
    pub candidate: Candidate,
}
fn error(message: impl Into<String>) -> CommandError {
    CommandError::new("edit.rejected", message)
}
pub fn source_patch(
    uri: &str,
    source: &str,
    range: Range,
    replacement: String,
) -> Result<SourcePatch, String> {
    let start = positions::position_byte(source, &range.start)?;
    let end = positions::position_byte(source, &range.end)?;
    if end < start {
        return Err("Patch range is reversed".into());
    }
    let mut after = source.to_owned();
    after.replace_range(start..end, &replacement);
    let patch = SourcePatch {
        uri: uri.into(),
        range,
        original: source[start..end].into(),
        replacement,
        before_hash: hash(source),
        after_hash: hash(&after),
    };
    patch.validate()?;
    Ok(patch)
}
fn hash(text: &str) -> String {
    format!("{:x}", Sha256::digest(text.as_bytes()))
}
/// Insert into an owner whose lexical body ends in `}` or `;`. Uses Text's
/// shared lexer so comments/quoted braces cannot become an insertion anchor.
pub fn insert_member(
    source: &str,
    owner_span: (usize, usize),
    declaration: &str,
) -> Result<(Range, String), String> {
    let (start, end) = owner_span;
    let fragment = source.get(start..end).ok_or("Invalid owner span")?;
    let tokens =
        intersect_text::grammar::lex_with_limit(fragment, Some(200_000)).map_err(|(_, e)| e)?;
    let last = tokens.last().ok_or("Owner has no lexical terminator")?;
    if !["}", ";"].contains(&last.text.as_str()) {
        return Err("Unsupported owner body terminator".into());
    }
    let anchor = start + last.start;
    let before_line = source[..start].rfind('\n').map_or(0, |i| i + 1);
    let indent: String = source[before_line..start]
        .chars()
        .take_while(|c| *c == ' ' || *c == '\t')
        .collect();
    let newline = if source.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let (at, length, replacement) = if last.text == ";" {
        (
            anchor,
            1,
            format!(" {{{newline}{indent}    {declaration}{newline}{indent}}}"),
        )
    } else {
        let line = source[..anchor].rfind('\n').map_or(anchor, |i| i + 1);
        if line >= start && source[line..anchor].chars().all(|c| c == ' ' || c == '\t') {
            (line, 0, format!("{indent}    {declaration}{newline}"))
        } else {
            (
                anchor,
                0,
                format!("{newline}{indent}    {declaration}{newline}{indent}"),
            )
        }
    };
    Ok((positions::range(source, at, at + length), replacement))
}
impl Host {
    /// Model-defined views may expose a writable canvas creation scope even
    /// when that namespace is not a rendered node. Data-only view documents
    /// cannot grant this capability. The real owner must match an authored
    /// rule's class, tool/command and Bool predicate on the accepted snapshot.
    fn canvas_owner(
        &self,
        rules: &intersect_views::GraphRuleSet,
        scene: &intersect_views::GraphScene,
        tool: &intersect_views::Tool,
        key: &str,
    ) -> Result<bool, String> {
        let snapshot = self.snapshot()?;
        if self.model_views.is_none()
            || snapshot
                .model()
                .lookup(&scene.view.binding.element_id)
                .is_none()
            || !scene.view.owners.iter().any(|o| o.key == key)
        {
            return Ok(false);
        }
        let Some(owner) = snapshot
            .keys
            .get(key)
            .and_then(|id| snapshot.model().lookup(id))
        else {
            return Ok(false);
        };
        if !self.editable.contains(owner.resource()) {
            return Ok(false);
        }
        let context = crate::ModelViewContext {
            host: self,
            snapshot,
            budget: std::cell::RefCell::new(intersect_model::core::query::QueryBudget::new(
                self.language.definition.view_function_work,
            )),
        };
        for rule in &rules.symbols {
            let Some(class) = snapshot.model().metamodel().class(&rule.class) else {
                continue;
            };
            if !snapshot.model().metamodel().is_a(owner.class(), class) {
                continue;
            }
            for create in &rule.create {
                if create.tool == tool.id
                    && create.command == tool.command
                    && context.boolean(&create.accepts, owner)?
                {
                    return Ok(true);
                }
            }
        }
        Ok(false)
    }
    pub(super) fn prepare_command(&mut self, params: &Value) -> Result<Value, CommandError> {
        self.check_revision(params).map_err(error)?;
        let snapshot = self.snapshot().map_err(error)?;
        if self.pending.is_some() {
            return Err(CommandError::new(
                "edit.pending",
                "A diagram edit is already prepared",
            ));
        }
        let command: PrepareCommand = serde_json::from_value(params.clone())
            .map_err(|e| error(format!("Invalid command: {e}")))?;
        let response = self
            .scene_response(
                &command.view_key,
                command.scope.as_ref(),
                command.palette.clone(),
            )
            .map_err(error)?;
        let ruleset = self.rules_for(response.scene.rule_set()).map_err(error)?;
        let tool = response
            .scene
            .palette()
            .groups
            .iter()
            .flat_map(|g| &g.entries)
            .find(|t| t.id == command.tool_id)
            .ok_or_else(|| error("Unknown palette tool"))?;
        let mut label_target = None;
        let mut lane_target = None;
        let (command_id, grid_target) = if let Some(part) = command.arguments.get("part") {
            let (target, reason) = self
                .checked_label_target_any(ruleset, &response.scene, tool, part)
                .map_err(error)?;
            if target.owner_binding.key != command.owner_key {
                return Err(error("Label ownerKey does not match the decorated symbol"));
            }
            if let Some(reason) = reason {
                return Err(CommandError::new("label.inapplicable", reason));
            }
            label_target = Some(target);
            (tool.command.clone(), None)
        } else {
            match ruleset {
                intersect_views::RuleSet::Graph(rules) => {
                    let command_id = intersect_view_engine::legality::command_for(rules, tool)
                        .ok_or_else(|| error("Tool is not authorized by the rule set"))?;
                    if !self.commands.supports(&command_id) {
                        return Err(CommandError::new(
                            "unsupported",
                            "Language command is not supported",
                        ));
                    }
                    let source = command.arguments.get("source").map(String::as_str);
                    let connect = rules
                        .edges
                        .iter()
                        .filter_map(|r| r.connect())
                        .any(|c| c.command == command_id);
                    let legal = self
                        .target_ids(
                            rules,
                            response.scene.graph().map_err(error)?,
                            tool,
                            if connect { source } else { None },
                        )
                        .map_err(error)?;
                    if connect {
                        let target = command
                            .arguments
                            .get("target")
                            .ok_or_else(|| error("Choose a target endpoint"))?;
                        if source.is_none() || !legal.contains(target) {
                            return Err(CommandError::new(
                                "edit.inapplicable",
                                "Connection endpoints do not pass the applicability predicates",
                            ));
                        }
                        if !self
                            .canvas_owner(
                                rules,
                                response.scene.graph().map_err(error)?,
                                tool,
                                &command.owner_key,
                            )
                            .map_err(error)?
                            && !intersect_view_engine::legality::nodes(
                                response.scene.graph().map_err(error)?,
                            )
                            .iter()
                            .any(|n| {
                                n.binding.key == command.owner_key
                                    && rules.edges.iter().any(|e| match e {
                                        intersect_views::EdgeRule::Element {
                                            per, connect, ..
                                        }
                                        | intersect_views::EdgeRule::Reference {
                                            per,
                                            connect,
                                            ..
                                        } => {
                                            *per == n.rule
                                                && connect
                                                    .as_ref()
                                                    .is_some_and(|c| c.command == command_id)
                                        }
                                    })
                            })
                        {
                            return Err(error("Connection owner is outside this view or rule"));
                        }
                    } else if !self
                        .canvas_owner(
                            rules,
                            response.scene.graph().map_err(error)?,
                            tool,
                            &command.owner_key,
                        )
                        .map_err(error)?
                        && !intersect_view_engine::legality::nodes(
                            response.scene.graph().map_err(error)?,
                        )
                        .iter()
                        .any(|n| n.binding.key == command.owner_key && legal.contains(&n.id))
                    {
                        return Err(CommandError::new(
                            "edit.inapplicable",
                            "Owner does not pass the creation predicate",
                        ));
                    }
                    (command_id, None)
                }
                intersect_views::RuleSet::LaneGraph(rules) => {
                    let get = |key: &str| {
                        command
                            .arguments
                            .get(key)
                            .map(String::as_str)
                            .ok_or_else(|| error(format!("Missing lane argument {key}")))
                    };
                    let (target, reason) = self
                        .checked_lane_target(
                            rules,
                            response.scene.lane_graph().map_err(error)?,
                            tool,
                            crate::lanes::LaneSelection {
                                step: get("step")?,
                                lane: get("lane")?,
                                before: Some(get("before")?).filter(|s| !s.is_empty()),
                                end: Some(get("end")?).filter(|s| !s.is_empty()),
                            },
                        )
                        .map_err(error)?;
                    if target.step.binding.key != command.owner_key {
                        return Err(error("Lane ownerKey does not match the Step"));
                    }
                    if let Some(reason) = reason {
                        return Err(CommandError::new("lane.inapplicable", reason));
                    }
                    lane_target = Some(target);
                    (tool.command.clone(), None)
                }
                intersect_views::RuleSet::Grid(rules) => {
                    let id = crate::grids::grid_command(rules, tool)
                        .ok_or_else(|| error("Tool is not authorized by grid rules"))?
                        .to_owned();
                    let row = command
                        .arguments
                        .get("row")
                        .ok_or_else(|| error("Choose a grid row"))?;
                    let column = command
                        .arguments
                        .get("column")
                        .ok_or_else(|| error("Choose a grid column"))?;
                    let (target, reason) = self
                        .checked_grid_target(
                            rules,
                            response.scene.grid().map_err(error)?,
                            tool,
                            row,
                            column,
                            command.arguments.get("member").map(String::as_str),
                        )
                        .map_err(error)?;
                    if target.row.binding.key != command.owner_key {
                        return Err(error("Grid ownerKey does not match the selected row"));
                    }
                    if let Some(reason) = reason {
                        return Err(CommandError::new("grid.inapplicable", reason));
                    }
                    (id, Some(target))
                }
            }
        };
        let functions = crate::ModelViewContext {
            host: self,
            snapshot,
            budget: std::cell::RefCell::new(intersect_model::core::query::QueryBudget::new(
                self.language.definition.view_function_work,
            )),
        };
        let patches = self.commands.prepare(
            &CommandContext {
                model: snapshot.model(),
                sources: &self.sources,
                revision: self.revision,
                command: &command_id,
                scene: &response.scene,
                keys: &snapshot.keys,
                grid_target,
                lane_target,
                label_target,
                functions: &functions,
            },
            &command,
        )?;
        if patches.is_empty() {
            return Err(error("Command produced no source patches"));
        }
        let mut sources = self.sources.clone();
        let mut seen = BTreeSet::new();
        for patch in &patches {
            patch.validate().map_err(error)?;
            if !self.editable.contains(&patch.uri) || !seen.insert(&patch.uri) {
                return Err(error("Patch URI is not editable or occurs more than once"));
            }
            let text = sources
                .get_mut(&patch.uri)
                .ok_or_else(|| error("Patch URI is unknown"))?;
            let start = positions::position_byte(text, &patch.range.start).map_err(error)?;
            let end = positions::position_byte(text, &patch.range.end).map_err(error)?;
            if end < start
                || text.get(start..end) != Some(patch.original.as_str())
                || hash(text) != patch.before_hash
            {
                return Err(error("Patch does not match the clean baseline"));
            }
            text.replace_range(start..end, &patch.replacement);
            if hash(text) != patch.after_hash {
                return Err(error("Patch result hash does not match"));
            }
        }
        let next_revision = self
            .revision
            .checked_add(1)
            .filter(|r| *r <= MAX_WIRE_INTEGER)
            .ok_or_else(|| error("Revision overflow"))?;
        let mut candidate = self
            .candidate(ProjectRequest {
                revision: next_revision,
                sources: sources
                    .iter()
                    .map(|(uri, text)| Source {
                        uri: uri.clone(),
                        text: text.clone(),
                    })
                    .collect(),
                project_nodes_only: self.project_nodes_only,
            })
            .map_err(error)?;
        if let Some(rejection) = candidate.rejection.take() {
            return Err(rejection);
        }
        let model = &candidate
            .snapshot
            .as_ref()
            .ok_or_else(|| error("Proposed edit has no clean accepted model"))?
            .model();
        let created = model
            .objects()
            .filter_map(|o| {
                let key = identity::key(o, &self.language.definition.name_features, &[]).ok()?;
                if snapshot.keys.contains_key(&key) {
                    return None;
                }
                let parent = o.container()?;
                let parent =
                    identity::key(parent, &self.language.definition.name_features, &[]).ok()?;
                snapshot.keys.contains_key(&parent).then_some(key)
            })
            .next()
            .unwrap_or_default();
        self.next_transaction = self
            .next_transaction
            .checked_add(1)
            .ok_or_else(|| error("Transaction identity overflow"))?;
        let token = format!("edit:{}:{}", self.revision, self.next_transaction);
        let prepared = PreparedEdit {
            schema_version: 1,
            token: token.clone(),
            base_revision: self.revision,
            next_revision,
            patches,
            created,
        };
        prepared.validate().map_err(error)?;
        let value = serde_json::to_value(prepared).map_err(|e| error(e.to_string()))?;
        self.pending = Some(Pending {
            token,
            base_revision: self.revision,
            candidate,
        });
        Ok(value)
    }
    pub(super) fn commit_command(&mut self, params: &Value) -> Result<Value, String> {
        self.check_revision(params)?;
        let pending = self.pending.as_ref().ok_or("No prepared diagram edit")?;
        if params["token"].as_str() != Some(pending.token.as_str())
            || pending.base_revision != self.revision
        {
            return Err("Prepared edit token is stale".into());
        }
        let received: Vec<Source> = serde_json::from_value(params["sources"].clone())
            .map_err(|e| format!("Invalid applied source receipt: {e}"))?;
        let mut seen = BTreeSet::new();
        if received.len() != pending.candidate.sources.len()
            || received.iter().any(|s| {
                !seen.insert(&s.uri) || pending.candidate.sources.get(&s.uri) != Some(&s.text)
            })
        {
            return Err(
                "Editor buffers differ from the prepared source edit; nothing was published".into(),
            );
        }
        let pending = self.pending.take().ok_or("Prepared edit disappeared")?;
        Ok(self.publish(pending.candidate))
    }
}
