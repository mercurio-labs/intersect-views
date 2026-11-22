//! Focused lane constraints and typed command targets over trusted scenes.
use crate::{
    Host, LaneCommandTarget,
    scenes::{FunctionAdapter, ModelAdapter},
};
use intersect_model::core::query::QueryBudget;
use intersect_view_engine::{ElementId, ViewFunctions, ViewModel};
use intersect_views::*;
use serde_json::{Value, json};
use std::cell::RefCell;
pub(super) struct LaneSelection<'a> {
    pub step: &'a str,
    pub lane: &'a str,
    pub before: Option<&'a str>,
    pub end: Option<&'a str>,
}
impl Host {
    pub(super) fn lane_response(
        &self,
        view: &View,
        doc: &ViewDocument,
        rules: &LaneGraphRuleSet,
        scope: Option<&Scope>,
        palette: Option<Palette>,
    ) -> Result<SceneResponse, String> {
        let snapshot = self.snapshot()?;
        let palette = match palette {
            Some(p) => p,
            None if self.language.definition.palette.is_empty() => {
                let mut entries = vec![
                    json!({"id":"select","label":"Select","icon":"pointer","gesture":"select","command":"presentation.select","parameters":{},"inputs":[]}),
                ];
                if let Some(edit) = &rules.lane_graph.edit {
                    entries.push(json!({"id":edit.tool,"label":"Place Step","icon":"box","gesture":"action","command":edit.command,"parameters":{"placement":"lane"},"inputs":[]}));
                }
                for rule in [&rules.lane_graph.lane.label, &rules.lane_graph.step.label] {
                    if let LabelRule::Parts(parts) = rule {
                        for edit in parts.parts.iter().filter_map(|p| p.edit.as_ref()) {
                            if let Some(existing) = entries.iter().find(|t| t["id"] == edit.tool) {
                                if existing["command"] != edit.command {
                                    return Err("Conflicting lane palette command mappings".into());
                                }
                            } else {
                                entries.push(json!({"id":edit.tool,"label":edit.tool,"icon":"box","gesture":"action","command":edit.command,"parameters":{},"inputs":[]}));
                            }
                        }
                    }
                }
                serde_json::from_value(json!({"schemaVersion":1,"id":format!("{}.default",rules.id),"label":rules.label,"groups":[{"id":"tools","label":"Tools","entries":entries}]})).map_err(|e|e.to_string())?
            }
            None => serde_json::from_str(&self.language.definition.palette)
                .map_err(|e| e.to_string())?,
        };
        palette.validate()?;
        let edits = [&rules.lane_graph.lane.label, &rules.lane_graph.step.label]
            .into_iter()
            .flat_map(|l| match l {
                LabelRule::Parts(r) => r
                    .parts
                    .iter()
                    .filter_map(|p| p.edit.as_ref())
                    .collect::<Vec<_>>(),
                _ => vec![],
            })
            .collect::<Vec<_>>();
        for edit in &edits {
            if let Some(tool) = palette
                .groups
                .iter()
                .flat_map(|g| &g.entries)
                .find(|t| t.id == edit.tool)
                && (tool.command != edit.command || tool.gesture != "action")
            {
                return Err("Lane label palette tool/command mismatch".into());
            }
        }

        let model = ModelAdapter::new(self, snapshot)?;
        let budget = RefCell::new(QueryBudget::new(
            self.language.definition.view_function_work,
        ));
        let functions = FunctionAdapter {
            cache: self.language.cache(),
            snapshot,
            budget: &budget,
        };
        let scene = intersect_view_engine::lane::evaluate(
            rules,
            scope.unwrap_or(&doc.scope),
            view.clone(),
            palette,
            self.revision,
            &model,
            &functions,
            intersect_view_engine::lane::LaneLimits {
                work: self.language.definition.view_function_work,
                ..Default::default()
            },
        )
        .map_err(|e| e.to_string())?;
        let capabilities = scene
            .palette
            .groups
            .iter()
            .flat_map(|g| &g.entries)
            .map(|t| {
                let enabled = edits.iter().any(|e| {
                    e.tool == t.id
                        && e.command == t.command
                        && t.gesture == "action"
                        && self.commands.supports(&e.command)
                }) || t.gesture == "select"
                    || matches!(
                        t.command.as_str(),
                        "presentation.fit" | "presentation.layout"
                    )
                    || rules.lane_graph.edit.as_ref().is_some_and(|e| {
                        e.tool == t.id
                            && e.command == t.command
                            && t.gesture == "action"
                            && self.commands.supports(&e.command)
                    });
                ToolCapability {
                    tool_id: t.id.clone(),
                    enabled,
                    reason: if enabled {
                        String::new()
                    } else {
                        "Tool has no supported lane command".into()
                    },
                }
            })
            .collect();
        let response = SceneResponse {
            scene: scene.into(),
            capabilities,
            presentation: self.presentation_context(),
        };
        response.validate()?;
        Ok(response)
    }
    pub(super) fn checked_lane_target<'a>(
        &self,
        rules: &LaneGraphRuleSet,
        scene: &'a LaneGraphScene,
        tool: &Tool,
        selection: LaneSelection<'_>,
    ) -> Result<(LaneCommandTarget<'a>, Option<String>), String> {
        let LaneSelection {
            step,
            lane,
            before,
            end,
        } = selection;
        let step = scene
            .steps
            .iter()
            .find(|s| s.id == step)
            .ok_or("Unknown lane Step")?;
        let lane = scene
            .lanes
            .iter()
            .find(|s| s.id == lane)
            .ok_or("Unknown lane band")?;
        let lookup = |id: &str| {
            scene
                .steps
                .iter()
                .find(|s| s.id == id)
                .ok_or("Unknown lane target Step")
        };
        let before = before.map(lookup).transpose()?;
        let end = end.map(lookup).transpose()?;
        if step.binding.context != lane.binding.context
            || before
                .iter()
                .chain(end.iter())
                .any(|s| s.id == step.id || s.binding.context != step.binding.context)
        {
            return Err("Lane target must use distinct Steps in the same container".into());
        }
        let snapshot = self.snapshot()?;
        let key = step
            .binding
            .context
            .first()
            .ok_or("Missing Step container")?;
        let model = ModelAdapter::new(self, snapshot)?;
        let container = model.element(key).ok_or("Container disappeared")?;
        let container_binding = model.binding(container, &[]).map_err(|e| e.to_string())?;
        let ordered = scene
            .order
            .iter()
            .filter_map(|id| {
                scene
                    .steps
                    .iter()
                    .find(|s| s.id == *id && s.binding.context == step.binding.context)
                    .map(|s| &s.binding)
            })
            .collect();
        let target = LaneCommandTarget {
            step,
            lane,
            before,
            end,
            container_binding,
            ordered,
        };
        let reason = if step.binding.read_only || target.container_binding.read_only {
            Some("Step or container is read-only".into())
        } else if let Some(edit) = &rules.lane_graph.edit {
            if edit.tool != tool.id
                || edit.command != tool.command
                || tool.gesture != "action"
                || !self.commands.supports(&edit.command)
            {
                Some("Unsupported lane placement tool".into())
            } else {
                let budget = RefCell::new(QueryBudget::new(
                    self.language.definition.view_function_work,
                ));
                let f = FunctionAdapter {
                    cache: self.language.cache(),
                    snapshot,
                    budget: &budget,
                };
                let object = snapshot
                    .model()
                    .lookup(&step.binding.element_id)
                    .ok_or("Step disappeared")?;
                if f.boolean(&edit.accepts, ElementId::new(object.id().index()))
                    .map_err(|e| e.to_string())?
                {
                    None
                } else {
                    Some("Lane placement predicate refused".into())
                }
            }
        } else {
            Some("No declared lane placement command".into())
        };
        Ok((target, reason))
    }
    pub(super) fn lane_targets(&self, params: &Value) -> Result<Value, String> {
        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct Request {
            revision: u64,
            view_key: String,
            tool_id: String,
            step: String,
            lane: String,
            #[serde(deserialize_with = "required_nullable")]
            before: Option<String>,
            #[serde(deserialize_with = "required_nullable")]
            end: Option<String>,
            scope: Option<Scope>,
            palette: Option<Palette>,
        }
        fn required_nullable<'de, D: serde::Deserializer<'de>>(
            d: D,
        ) -> Result<Option<String>, D::Error> {
            serde::Deserialize::deserialize(d)
        }
        self.check_revision(params)?;
        let r: Request = serde_json::from_value(params.clone()).map_err(|e| e.to_string())?;
        let response = self.scene_response(&r.view_key, r.scope.as_ref(), r.palette)?;
        let scene = response.scene.lane_graph()?;
        let RuleSet::LaneGraph(rules) = self.rules_for(&scene.rule_set)? else {
            return Err("Expected lane rules".into());
        };
        let tool = scene
            .palette
            .groups
            .iter()
            .flat_map(|g| &g.entries)
            .find(|t| t.id == r.tool_id)
            .ok_or("Unknown lane tool")?;
        let (_, reason) = self.checked_lane_target(
            rules,
            scene,
            tool,
            LaneSelection {
                step: &r.step,
                lane: &r.lane,
                before: r.before.as_deref(),
                end: r.end.as_deref(),
            },
        )?;
        let response = LaneTargetResponse {
            revision: r.revision,
            view_key: r.view_key,
            tool_id: r.tool_id,
            step: r.step,
            lane: r.lane,
            before: r.before,
            end: r.end,
            enabled: reason.is_none(),
            reason: reason.unwrap_or_default(),
        };
        response.validate()?;
        Ok(json!(response))
    }
}
