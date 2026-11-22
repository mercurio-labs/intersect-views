//! Focused label applicability over a freshly recomputed, trusted scene.
use crate::{Host, LabelCommandTarget, scenes::FunctionAdapter};
use intersect_model::core::query::QueryBudget;
use intersect_view_engine::{ElementId, ViewFunctions};
use intersect_views::*;
use serde_json::{Value, json};
use std::cell::RefCell;

fn label<'a>(
    value: &'a Label,
    owner: &'a str,
    binding: &'a Binding,
    slot: &'static str,
    rule: &'a LabelRule,
    id: &str,
) -> Option<(LabelCommandTarget<'a>, &'a LabelRule)> {
    value.parts.iter().find(|p| p.id == id).map(|part| {
        (
            LabelCommandTarget {
                owner_symbol: owner,
                owner_binding: binding,
                slot,
                part,
            },
            rule,
        )
    })
}
fn find<'a>(
    scene: &'a GraphScene,
    rules: &'a GraphRuleSet,
    id: &str,
) -> Option<(LabelCommandTarget<'a>, &'a LabelRule)> {
    for n in intersect_view_engine::legality::nodes(scene) {
        let r = rules.symbols.iter().find(|r| r.id == n.rule)?;
        for (value, slot, rule) in [
            (&n.title, "node.title", r.title.as_ref()),
            (&n.subtitle, "node.subtitle", r.subtitle.as_ref()),
        ] {
            if let Some(rule) = rule
                && let Some(found) = label(value, &n.id, &n.binding, slot, rule, id)
            {
                return Some(found);
            }
        }
        for (c, rule) in n.compartments.iter().zip(&r.compartments) {
            for row in &c.rows {
                if let Some(found) = label(
                    &row.label,
                    &row.id,
                    &row.binding,
                    "row.label",
                    &rule.row_label,
                    id,
                ) {
                    return Some(found);
                }
            }
        }
        for p in &n.ports {
            if let Some(rule) = rules
                .symbols
                .iter()
                .find(|r| r.id == p.rule)
                .and_then(|r| r.label.as_ref())
                && let Some(found) = label(&p.label, &p.id, &p.binding, "port.label", rule, id)
            {
                return Some(found);
            }
        }
        if let (Some(regions), Some(rule)) = (&n.regions, &r.regions) {
            for region in &regions.items {
                if let Some(found) = label(
                    &region.label,
                    &region.id,
                    &region.binding,
                    "region.label",
                    &rule.label,
                    id,
                ) {
                    return Some(found);
                }
            }
        }
    }
    for e in &scene.edges {
        if let Some(rule) = rules.edges.iter().find(|r| r.id() == e.rule) {
            let (EdgeRule::Element { label: rule, .. } | EdgeRule::Reference { label: rule, .. }) =
                rule;
            if let Some(found) = label(&e.label, &e.id, &e.binding, "edge.label", rule, id) {
                return Some(found);
            }
        }
    }
    None
}
impl Host {
    pub(super) fn checked_label_target<'a>(
        &self,
        rules: &'a GraphRuleSet,
        scene: &'a GraphScene,
        tool: &Tool,
        id: &str,
    ) -> Result<(LabelCommandTarget<'a>, Option<String>), String> {
        let (target, rule) = find(scene, rules, id).ok_or("Unknown label part")?;
        self.check_label(&scene.view.key, &rules.id, tool, target, rule)
    }
    pub(super) fn checked_label_target_any<'a>(
        &self,
        rules: &'a RuleSet,
        scene: &'a Scene,
        tool: &Tool,
        id: &str,
    ) -> Result<(LabelCommandTarget<'a>, Option<String>), String> {
        match (rules, scene) {
            (RuleSet::Graph(r), Scene::Graph(s)) => self.checked_label_target(r, s, tool, id),
            (RuleSet::LaneGraph(r), Scene::LaneGraph(s)) => {
                let found = s
                    .lanes
                    .iter()
                    .find_map(|l| {
                        label(
                            &l.label,
                            &l.id,
                            &l.binding,
                            "lane.label",
                            &r.lane_graph.lane.label,
                            id,
                        )
                    })
                    .or_else(|| {
                        s.steps.iter().find_map(|t| {
                            label(
                                &t.label,
                                &t.id,
                                &t.binding,
                                "step.label",
                                &r.lane_graph.step.label,
                                id,
                            )
                        })
                    })
                    .ok_or("Unknown lane label part")?;
                self.check_label(&s.view.key, &r.id, tool, found.0, found.1)
            }
            _ => Err("This form has no structured label targets".into()),
        }
    }
    fn check_label<'a>(
        &self,
        view: &str,
        rules: &str,
        tool: &Tool,
        target: LabelCommandTarget<'a>,
        rule: &LabelRule,
    ) -> Result<(LabelCommandTarget<'a>, Option<String>), String> {
        let disabled = |reason: &str| Ok((target, Some(reason.to_owned())));
        let Some(binding) = target.part.binding.as_ref() else {
            return disabled("Unbound label part");
        };
        let LabelRule::Parts(parts) = rule else {
            return disabled("No declared label action");
        };
        let authored = parts.parts.iter().find(|p| {
            intersect_view_engine::graph::part_id(
                view,
                rules,
                target.owner_symbol,
                target.slot,
                &p.id,
                Some(&binding.key),
            )
            .is_ok_and(|id| id == target.part.id)
        });
        let Some(edit) = authored.and_then(|p| p.edit.as_ref()).filter(|e| {
            e.tool == tool.id
                && e.command == tool.command
                && tool.gesture == "action"
                && target.part.edit_tool.as_deref() == Some(e.tool.as_str())
        }) else {
            return disabled("Tool is not declared for this label part");
        };
        if binding.read_only {
            return disabled("Label subject is read-only");
        }
        if !self.commands.supports(&edit.command) {
            return disabled("Language command is not supported");
        }
        let snapshot = self.snapshot()?;
        let object = snapshot
            .model()
            .lookup(&binding.element_id)
            .ok_or("Label subject disappeared")?;
        let budget = RefCell::new(QueryBudget::new(
            self.language.definition.view_function_work,
        ));
        let functions = FunctionAdapter {
            cache: self.language.cache(),
            snapshot,
            budget: &budget,
        };
        if !functions
            .boolean(&edit.accepts, ElementId::new(object.id().index()))
            .map_err(|e| e.to_string())?
        {
            return disabled("Label subject does not pass the applicability predicate");
        }
        Ok((target, None))
    }
    pub(super) fn label_targets(&self, params: &Value) -> Result<Value, String> {
        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct Request {
            revision: u64,
            view_key: String,
            tool_id: String,
            part: String,
            scope: Option<Scope>,
            palette: Option<Palette>,
        }
        let p: Request = serde_json::from_value(params.clone())
            .map_err(|e| format!("Invalid label target request: {e}"))?;
        let response = self.scene_response(&p.view_key, p.scope.as_ref(), p.palette)?;
        let scene = &response.scene;
        let rules = self.rules_for(scene.rule_set())?;
        let tool = scene
            .palette()
            .groups
            .iter()
            .flat_map(|g| &g.entries)
            .find(|t| t.id == p.tool_id)
            .ok_or("Unknown palette tool")?;
        let (_, reason) = self.checked_label_target_any(rules, scene, tool, &p.part)?;
        Ok(json!(LabelTargetResponse {
            revision: p.revision,
            view_key: p.view_key,
            tool_id: p.tool_id,
            part: p.part,
            enabled: reason.is_none(),
            reason: reason.unwrap_or_default()
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn label_target_checks_subject_writability_and_command_support() -> Result<(), String> {
        let d = intersect_view_harness::definition();
        let definition = crate::LanguageDefinition {
            id: d.id,
            name: d.name,
            namespace: d.namespace,
            file_extensions: d.file_extensions,
            structure: d.structure,
            grammar: d.grammar,
            bindings: d.bindings,
            view_functions: d.view_functions,
            extra_functions: d.extra_functions,
            view_execution_limits: d.view_execution_limits,
            view_function_work: d.view_function_work,
            rule_sets: d.rule_sets,
            notation: d.notation,
            palette: d.palette,
            name_features: d.name_features,
        };
        struct Supported;
        impl crate::Commands for Supported {
            fn supports(&self, _: &str) -> bool {
                true
            }
            fn prepare(
                &self,
                _: &crate::CommandContext<'_>,
                _: &PrepareCommand,
            ) -> Result<Vec<SourcePatch>, crate::CommandError> {
                Err(crate::CommandError::new(
                    "test",
                    "Hints cannot call a provider",
                ))
            }
        }
        let mut host = Host::new(definition, Box::new(Supported))?;
        host.dispatch(json!({"method":"workspace/analyze","params":{"revision":1,"sources":[{"uri":"regions.harness","text":include_str!("../../../harness/models/regions.harness")},{"uri":"regions.view.json","text":json!({"schemaVersion":1,"key":"regions","name":"Regions","ruleSet":"harness.regions","scope":{"schemaVersion":1,"ops":[]}}).to_string()}]}}))?;
        let catalog = host.dispatch(json!({"method":"views/catalog","params":{"revision":1}}))?;
        let alpha = catalog["views"][0]["owners"]
            .as_array()
            .ok_or("No owners")?
            .iter()
            .find(|o| o["label"] == "Alpha")
            .ok_or("No Alpha")?["key"]
            .clone();
        let response:SceneResponse=serde_json::from_value(host.dispatch(json!({"method":"views/scene","params":{"revision":1,"viewKey":"regions","scope":{"schemaVersion":1,"ops":[{"op":"addSeed","element":alpha}]}}}))?).map_err(|e|e.to_string())?;
        let mut scene = response.scene.graph()?.clone();
        let tool = scene
            .palette
            .groups
            .iter()
            .flat_map(|g| &g.entries)
            .find(|t| t.id == "field-value")
            .ok_or("No tool")?
            .clone();
        let row = &mut scene.nodes[0].regions.as_mut().ok_or("No regions")?.items[0].children[0]
            .compartments[0]
            .rows[0];
        row.binding.read_only = true;
        let part = row.label.parts[2].id.clone(); // Checked target uses the subject's flag, independently of the primary owner.
        let rules = host.rules_for("harness.regions")?.graph()?;
        assert!(
            host.checked_label_target(rules, &scene, &tool, &part)?
                .1
                .is_none()
        );
        scene.nodes[0].regions.as_mut().ok_or("No regions")?.items[0].children[0].compartments[0]
            .rows[0]
            .label
            .parts[2]
            .binding
            .as_mut()
            .ok_or("No binding")?
            .read_only = true;
        assert!(
            host.checked_label_target(rules, &scene, &tool, &part)?
                .1
                .is_some_and(|s| s.contains("read-only"))
        );
        scene.nodes[0].regions.as_mut().ok_or("No regions")?.items[0].children[0].compartments[0]
            .rows[0]
            .label
            .parts[2]
            .binding
            .as_mut()
            .ok_or("No binding")?
            .read_only = false;
        host.commands = Box::new(crate::NoCommands);
        let rules = host.rules_for("harness.regions")?.graph()?;
        assert!(
            host.checked_label_target(rules, &scene, &tool, &part)?
                .1
                .is_some_and(|s| s.contains("not supported"))
        );
        Ok(())
    }
}
