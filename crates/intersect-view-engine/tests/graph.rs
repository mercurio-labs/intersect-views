use intersect_view_engine::{
    ElementId, EngineError, EngineLimits, ViewFunctions, ViewModel, evaluate,
};
use intersect_views::{Binding, GraphRuleSet, GraphScene, Palette, Position, Range, Scope, View};
use serde_json::json;
use std::collections::{BTreeMap, BTreeSet};
type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error>>;
#[test]
fn applicability_is_per_symbol_ordered_read_only_aware_and_bounded() -> Result {
    use intersect_view_engine::legality;
    let f = Fake::basic();
    let mut r = rules()?;
    r.symbols[0].create = vec![intersect_views::CreateRule {
        tool: "create".into(),
        command: "createBox".into(),
        accepts: "allow".into(),
    }];
    let mut s = scene(&f, &r, &scope(&[0, 1]), EngineLimits::default())?;
    let tool: intersect_views::Tool = serde_json::from_value(
        json!({"id":"create","label":"Create","icon":"box","gesture":"place","command":"createBox"}),
    )?;
    let allowed = legality::targets(&r, &s, &tool, None, &f, &f, EngineLimits::default())?;
    assert_eq!(allowed, vec![s.nodes[0].id.clone(), s.nodes[1].id.clone()]);
    s.nodes[0].binding.read_only = true;
    assert_eq!(
        legality::targets(&r, &s, &tool, None, &f, &f, EngineLimits::default())?,
        vec![s.nodes[1].id.clone()]
    );
    r.symbols[0].create[0].accepts = "deny".into();
    assert!(legality::targets(&r, &s, &tool, None, &f, &f, EngineLimits::default())?.is_empty());
    assert!(
        legality::targets(
            &r,
            &s,
            &tool,
            None,
            &f,
            &f,
            EngineLimits {
                function_work: 0,
                ..EngineLimits::default()
            }
        )
        .err()
        .ok_or("No budget error")?
        .0
        .contains("work units")
    );
    Ok(())
}
#[test]
fn reference_edges_from_repeated_sources_keep_occurrence_identity() -> Result {
    let mut f = Fake::basic();
    f.seq("children", 0, &[5]);
    f.seq("children", 1, &[5]);
    f.seq("references", 5, &[0]);
    let result = scene(&f, &rules()?, &scope(&[0, 1]), EngineLimits::default())?;
    assert_eq!(result.edges.len(), 2);
    assert_ne!(result.edges[0].id, result.edges[1].id);
    assert_eq!(result.edges[0].binding.context, vec!["e:0"]);
    assert_eq!(result.edges[1].binding.context, vec!["e:1"]);
    Ok(())
}
#[test]
fn explicit_hide_reports_exact_incident_edges_without_dropping_other_contexts() -> Result {
    let mut f = Fake::basic();
    f.seq("children", 0, &[5]);
    f.seq("children", 1, &[5]);
    f.seq("references", 5, &[0]);
    let mut scoped = scope(&[0, 1]);
    let all = scene(&f, &rules()?, &scoped, EngineLimits::default())?;
    assert_eq!(all.edges.len(), 2);
    scoped.ops.push(intersect_views::ScopeOp::Hide {
        element: "e:0".into(),
    });
    let hidden = scene(&f, &rules()?, &scoped, EngineLimits::default())?;
    assert_eq!(hidden.nodes.len(), 1);
    assert_eq!(hidden.nodes[0].id, all.nodes[1].id);
    // Both logical references target root 0; their separate source contexts do
    // not turn either relationship into a proxy or an unrelated visible edge.
    assert!(hidden.edges.is_empty());
    assert!(hidden.endpoint_proxies.is_empty());
    assert!(
        hidden
            .problems
            .iter()
            .any(|p| p == "Hidden 1 root(s) and 2 incident edge(s)")
    );
    assert!(
        scene(
            &f,
            &rules()?,
            &scoped,
            EngineLimits {
                nodes: 3,
                ..EngineLimits::default()
            }
        )
        .is_err()
    );
    Ok(())
}
#[test]
fn ordered_exploration_hops_origins_and_missing_keys() -> Result {
    let mut f = Fake::basic();
    f.seq("related", 0, &[1]);
    f.seq("related", 1, &[5]);
    f.seq("related", 5, &[0]);
    let run = |ops: serde_json::Value| -> Result<GraphScene> {
        Ok(scene(
            &f,
            &rules()?,
            &serde_json::from_value(json!({"schemaVersion":1,"ops":ops}))?,
            EngineLimits::default(),
        )?)
    };
    let expanded = run(
        json!([{"op":"addSeed","element":"e:0"},{"op":"expand","element":"e:0","relation":"related","hops":2},{"op":"hide","element":"e:1"},{"op":"addSeed","element":"e:1"},{"op":"removeSeed","element":"e:0"}]),
    )?;
    assert_eq!(
        expanded
            .nodes
            .iter()
            .map(|n| n.title.text())
            .collect::<Vec<_>>(),
        vec!["e:5", "e:1"]
    );
    let retained = run(
        json!([{"op":"addSeed","element":"e:1"},{"op":"expand","element":"e:0","relation":"related","hops":1},{"op":"removeSeed","element":"e:1"}]),
    )?;
    assert_eq!(retained.nodes[0].title, "e:1");
    let cycle = run(json!([{"op":"expand","element":"e:0","relation":"related","hops":8}]))?;
    assert_eq!(cycle.nodes.len(), 3);
    let missing = run(
        json!([{"op":"hide","element":"gone"},{"op":"removeSeed","element":"gone"},{"op":"expand","element":"gone","relation":"related","hops":1},{"op":"collapse","element":"gone","context":[]}]),
    )?;
    assert_eq!(missing.problems.len(), 4);
    assert!(run(json!([{"op":"expand","element":"e:0","relation":"unknown","hops":1}])).is_err());
    assert!(run(json!([{"op":"expand","element":"e:0","relation":"related","hops":9}])).is_err());
    assert!(
        run(json!(
            (0..4097)
                .map(|_| json!({"op":"addSeed","element":"e:0"}))
                .collect::<Vec<_>>()
        ))
        .is_err()
    );
    Ok(())
}
#[test]
fn collapse_is_occurrence_specific_and_saved_scope_reloads_identically() -> Result {
    let mut f = Fake::basic();
    f.seq("children", 0, &[5]);
    f.seq("children", 1, &[5]);
    f.seq("pins", 5, &[2]);
    f.seq("links", 5, &[4]);
    f.seq("source", 4, &[2]);
    f.seq("target", 4, &[2]);
    let scope: Scope = serde_json::from_value(
        json!({"schemaVersion":1,"ops":[{"op":"addSeed","element":"e:0"},{"op":"addSeed","element":"e:1"},{"op":"collapse","element":"e:5","context":["e:0"]}]}),
    )?;
    let result = scene(&f, &rules()?, &scope, EngineLimits::default())?;
    assert!(result.nodes[0].children[0].collapsed);
    assert!(result.nodes[0].children[0].ports.is_empty());
    assert!(!result.nodes[1].children[0].collapsed);
    assert_eq!(result.nodes[1].children[0].ports.len(), 1);
    assert_eq!(result.edges.len(), 2);
    assert_eq!(result.endpoint_proxies.len(), 1);
    let proxy = &result.endpoint_proxies[0];
    assert_eq!(proxy.display_owner, result.nodes[0].children[0].id);
    assert_eq!(proxy.binding.context, vec!["e:0", "e:5"]);
    assert!(
        result
            .edges
            .iter()
            .any(|e| e.source == proxy.id && e.target == proxy.id)
    );
    let doc = intersect_views::ViewDocument {
        schema_version: 1,
        key: "view".into(),
        name: "Saved".into(),
        rule_set: "rules".into(),
        scope,
    };
    let reload: intersect_views::ViewDocument = serde_json::from_slice(&serde_json::to_vec(&doc)?)?;
    assert_eq!(
        serde_json::to_vec(&result)?,
        serde_json::to_vec(&scene(
            &f,
            &rules()?,
            &reload.scope,
            EngineLimits::default()
        )?)?
    );
    Ok(())
}
#[test]
fn collapsed_hidden_work_is_charged_and_proxies_never_become_command_endpoints() -> Result {
    let mut f = Fake::basic();
    f.seq("children", 0, &[5]);
    f.seq("pins", 5, &[2]);
    f.seq("links", 5, &[4]);
    f.seq("source", 4, &[2]);
    f.seq("target", 4, &[2]);
    let r = rules()?;
    let expanded = scene(&f, &r, &scope(&[0]), EngineLimits::default())?;
    let mut collapsed = scope(&[0]);
    for (element, context) in [("e:5", vec!["e:0".into()]), ("e:0", vec![])] {
        collapsed.ops.push(intersect_views::ScopeOp::Collapse {
            element: element.into(),
            context,
        });
    }
    let projected = scene(&f, &r, &collapsed, EngineLimits::default())?;
    assert_eq!(projected.edges[0].id, expanded.edges[0].id);
    assert_eq!(projected.edges[0].source, expanded.edges[0].source);
    let proxy = &projected.endpoint_proxies[0];
    assert_eq!(proxy.display_owner, projected.nodes[0].id);
    assert_eq!(
        serde_json::to_value(&proxy.binding)?,
        serde_json::to_value(&expanded.nodes[0].children[0].ports[0].binding)?
    );
    assert!(intersect_view_engine::legality::endpoint(&projected, &proxy.id).is_none());
    let limited = scene(
        &f,
        &r,
        &collapsed,
        EngineLimits {
            nodes: 1,
            ..EngineLimits::default()
        },
    );
    assert!(
        limited
            .err()
            .ok_or("Hidden node work was not charged")?
            .0
            .contains("nodes")
    );
    Ok(())
}
#[test]
fn source_text_refuses_adapters_without_stored_source_instead_of_inventing_content() -> Result {
    let f = Fake::basic();
    let mut r = rules()?;
    r.symbols[0].title = Some(serde_json::from_value(json!({"sourceText":true}))?);
    let error = scene(&f, &r, &scope(&[0]), EngineLimits::default())
        .err()
        .ok_or("Missing unsupported-source refusal")?;
    assert!(error.0.contains("Source text is unavailable"));
    Ok(())
}
#[derive(Default)]
struct Fake {
    context_keys: bool,
    classes: Vec<&'static str>,
    bases: BTreeMap<&'static str, Vec<&'static str>>,
    sequences: BTreeMap<(String, usize), Vec<usize>>,
}
impl Fake {
    fn basic() -> Self {
        Self {
            classes: vec!["Box", "Box", "Pin", "Field", "Link", "Box"],
            bases: [
                ("Box", vec!["Element"]),
                ("Pin", vec!["Element"]),
                ("Field", vec!["Element"]),
                ("Link", vec!["Element"]),
            ]
            .into(),
            ..Self::default()
        }
    }
    fn seq(&mut self, name: &str, id: usize, values: &[usize]) {
        self.sequences.insert((name.into(), id), values.to_vec());
    }
    fn conforms(&self, class: &str, base: &str) -> bool {
        let mut stack = vec![class];
        let mut seen = BTreeSet::new();
        while let Some(class) = stack.pop() {
            if class == base {
                return true;
            }
            if seen.insert(class)
                && let Some(bases) = self.bases.get(class)
            {
                stack.extend(bases.iter().copied());
            }
        }
        false
    }
}
fn binding(key: String, context: &[String]) -> Binding {
    Binding {
        key: key.clone(),
        element_id: key,
        context: context.to_vec(),
        uri: "fixture.model".into(),
        range: Range {
            start: Position {
                line: 0,
                character: 0,
            },
            end: Position {
                line: 0,
                character: 1,
            },
        },
        read_only: false,
    }
}
impl ViewModel for Fake {
    fn element(&self, key: &str) -> Option<ElementId> {
        let id = key.strip_prefix("e:")?.parse::<usize>().ok()?;
        (id < self.classes.len()).then_some(ElementId::new(id))
    }
    fn key(&self, id: ElementId) -> std::result::Result<String, EngineError> {
        if id.index() >= self.classes.len() {
            Err(EngineError("Missing element".into()))
        } else {
            Ok(format!("e:{}", id.index()))
        }
    }
    fn is_a(&self, id: ElementId, class: &str) -> std::result::Result<bool, EngineError> {
        Ok(self.conforms(self.classes[id.index()], class))
    }
    fn class_is_a(&self, class: &str, base: &str) -> std::result::Result<bool, EngineError> {
        Ok(self.conforms(class, base))
    }
    fn binding(
        &self,
        id: ElementId,
        context: &[String],
    ) -> std::result::Result<Binding, EngineError> {
        let mut b = binding(self.key(id)?, context);
        if self.context_keys && !context.is_empty() {
            b.key = format!("{}@{}", b.key, context.join("/"));
        }
        Ok(b)
    }
}
impl ViewFunctions for Fake {
    fn elements(
        &self,
        name: &str,
        id: ElementId,
    ) -> std::result::Result<Vec<ElementId>, EngineError> {
        Ok(self
            .sequences
            .get(&(name.into(), id.index()))
            .into_iter()
            .flatten()
            .map(|i| ElementId::new(*i))
            .collect())
    }
    fn boolean(&self, name: &str, _: ElementId) -> std::result::Result<bool, EngineError> {
        Ok(name != "deny")
    }
    fn string(&self, name: &str, id: ElementId) -> std::result::Result<String, EngineError> {
        if name == "label" {
            self.key(id)
        } else {
            Err(EngineError(format!("Unknown string function {name}")))
        }
    }
}
fn rules() -> Result<GraphRuleSet> {
    Ok(serde_json::from_value(json!({
     "schemaVersion":8,"routing":{"algorithm":"orthogonal","clearance":8,"stubLength":18,"trunks":"none"},"projection":{"kind":"nested"},"id":"rules","label":"Rules","language":"fixture","form":"graph","layout":{"strategy":"layered","direction":"RIGHT"},
     "symbols":[{"id":"box","match":"Box","emit":"node","notation":"box","title":"label","ports":{"select":"pins","rule":"pin"},"children":{"select":"children"},"compartments":[{"id":"fields","label":"Fields","rows":"rows","rowLabel":"label"}],"expand":[{"id":"related","label":"Related","select":"related"}]},
     {"id":"pin","match":"Pin","emit":"port","label":"label","side":{"text":"EAST"}}],
     "edges":[{"kind":"element","id":"link","per":"box","select":"links","notation":"line","label":"label","sourcePath":"source","targetPath":"target","anchor":"owner"},
     {"kind":"reference","id":"ref","per":"box","targets":"references","notation":"typing","label":{"text":"type"},"anchor":"root"}]
    }))?)
}
#[test]
fn root_only_filters_each_occurrence_before_either_edge_selector_runs() -> Result {
    let mut f = Fake::basic();
    f.seq("children", 0, &[1]);
    f.seq("children", 1, &[5]);
    f.seq("pins", 1, &[2]);
    f.seq("links", 1, &[4]);
    f.seq("source", 4, &[2]);
    f.seq("target", 4, &[5]);
    f.seq("references", 1, &[0]);
    let mut r = rules()?;
    let before = scene(&f, &r, &scope(&[0, 1]), EngineLimits::default())?;
    assert_eq!(before.edges.len(), 4);
    for edge in &mut r.edges {
        let (intersect_views::EdgeRule::Element { root_only, .. }
        | intersect_views::EdgeRule::Reference { root_only, .. }) = edge;
        *root_only = true;
    }
    let after = scene(&f, &r, &scope(&[0, 1]), EngineLimits::default())?;
    assert_eq!(after.edges.len(), 2);
    assert_eq!(after.edges.iter().filter(|e| e.rule == "ref").count(), 1);
    assert_eq!(after.edges.iter().filter(|e| e.rule == "link").count(), 1);
    assert_eq!(
        after
            .edges
            .iter()
            .find(|e| e.rule == "ref")
            .ok_or("No root reference")?
            .source,
        after.nodes[1].id
    );
    assert_eq!(
        serde_json::to_vec(&after)?,
        serde_json::to_vec(&scene(&f, &r, &scope(&[0, 1]), EngineLimits::default())?)?
    );
    after.validate()?;
    Ok(())
}
fn scope(ids: &[usize]) -> Scope {
    Scope {
        schema_version: 1,
        ops: ids
            .iter()
            .map(|i| intersect_views::ScopeOp::AddSeed {
                element: format!("e:{i}"),
            })
            .collect(),
    }
}
fn scene(
    fake: &Fake,
    rules: &GraphRuleSet,
    scope: &Scope,
    limits: EngineLimits,
) -> std::result::Result<GraphScene, EngineError> {
    let view = View {
        key: "view".into(),
        name: "Test".into(),
        kind: "graph".into(),
        binding: binding("document".into(), &[]),
        owners: vec![],
        details: vec![],
        problems: vec![],
    };
    let palette = Palette {
        schema_version: 1,
        id: "tools".into(),
        label: "Tools".into(),
        groups: vec![],
    };
    evaluate(rules, scope, view, palette, 1, fake, fake, limits)
}
#[test]
fn roots_preserve_order_deduplicate_and_report_missing_elements() -> Result {
    let f = Fake::basic();
    let mut s = scope(&[1, 0, 1, 2]);
    s.ops.push(intersect_views::ScopeOp::AddSeed {
        element: "missing".into(),
    });
    let result = scene(&f, &rules()?, &s, EngineLimits::default())?;
    assert_eq!(
        result
            .nodes
            .iter()
            .map(|n| n.title.text())
            .collect::<Vec<_>>(),
        vec!["e:1", "e:0"]
    );
    assert_eq!(result.problems.len(), 1);
    assert!(result.problems[0].contains("missing"));
    Ok(())
}
#[test]
fn inherited_occurrences_have_distinct_symbols_and_matching_anchored_edges() -> Result {
    let mut f = Fake::basic();
    f.classes = vec!["Box", "Box", "Box", "Pin", "Field", "Link"];
    for root in [0, 1] {
        f.seq("children", root, &[2]);
        f.seq("links", root, &[5, 5]);
    }
    f.seq("pins", 2, &[3]);
    f.seq("rows", 2, &[4]);
    f.seq("source", 5, &[2, 3]);
    f.seq("target", 5, &[2]);
    let result = scene(&f, &rules()?, &scope(&[0, 1]), EngineLimits::default())?;
    let a = &result.nodes[0].children[0];
    let b = &result.nodes[1].children[0];
    assert_ne!(a.id, b.id);
    assert_eq!(a.binding.key, b.binding.key);
    assert_eq!(a.binding.context, vec!["e:0"]);
    assert_eq!(a.ports[0].binding.context, vec!["e:0", "e:2"]);
    assert_ne!(a.compartments[0].rows[0].id, b.compartments[0].rows[0].id);
    assert_eq!(result.edges.len(), 2);
    assert_ne!(result.edges[0].id, result.edges[1].id);
    assert_eq!(result.edges[0].binding.key, result.edges[1].binding.key);
    assert_eq!(result.edges[0].source, a.ports[0].id);
    assert_eq!(result.edges[0].target, a.id);
    assert_eq!(result.edges[1].source, b.ports[0].id);
    assert_eq!(result.edges[1].target, b.id);
    result.validate()?;
    Ok(())
}
#[test]
fn reference_edges_distinguish_targets_and_bind_the_source() -> Result {
    let mut f = Fake::basic();
    f.seq("references", 0, &[1, 5, 1]);
    let result = scene(&f, &rules()?, &scope(&[0, 1, 5]), EngineLimits::default())?;
    assert_eq!(result.edges.len(), 2);
    assert_ne!(result.edges[0].id, result.edges[1].id);
    for edge in &result.edges {
        assert_eq!(edge.source, result.nodes[0].id);
        assert_eq!(edge.binding.key, "e:0");
    }
    assert_eq!(result.edges[0].target, result.nodes[1].id);
    assert_eq!(result.edges[1].target, result.nodes[2].id);
    Ok(())
}
#[test]
fn root_anchors_deduplicate_element_edges_across_owners() -> Result {
    let mut f = Fake::basic();
    for root in [0, 1] {
        f.seq("links", root, &[4]);
    }
    f.seq("source", 4, &[0]);
    f.seq("target", 4, &[1]);
    let mut r = rules()?;
    if let intersect_views::EdgeRule::Element { anchor, .. } = &mut r.edges[0] {
        *anchor = "root".into();
    }
    let result = scene(&f, &r, &scope(&[0, 1]), EngineLimits::default())?;
    assert_eq!(result.edges.len(), 1);
    assert_eq!(result.edges[0].source, result.nodes[0].id);
    assert_eq!(result.edges[0].target, result.nodes[1].id);
    Ok(())
}
#[test]
fn unresolved_endpoints_are_problems_not_truncated_errors() -> Result {
    let mut f = Fake::basic();
    f.seq("pins", 0, &[2]);
    f.seq("links", 0, &[4]);
    f.seq("source", 4, &[2]);
    f.seq("target", 4, &[5]);
    let result = scene(&f, &rules()?, &scope(&[0]), EngineLimits::default())?;
    assert!(result.edges.is_empty());
    assert!(result.problems[0].contains("link"));
    assert!(result.problems[0].contains("e:4"));
    Ok(())
}
#[test]
fn most_specific_rules_win_and_incomparable_rules_use_file_order() -> Result {
    let mut f = Fake::basic();
    f.classes = vec!["D"];
    f.bases = [
        ("D", vec!["C", "B"]),
        ("C", vec!["A"]),
        ("A", vec!["Element"]),
        ("B", vec!["Element"]),
    ]
    .into();
    let mut r = rules()?;
    r.edges.clear();
    r.symbols = serde_json::from_value(json!([
 {"id":"a","match":"A","emit":"node","title":{"text":"A"}},
 {"id":"b","match":"B","emit":"node","title":{"text":"B"}},
 {"id":"c","match":"C","emit":"node","title":{"text":"C"}}]))?;
    assert_eq!(
        scene(&f, &r, &scope(&[0]), EngineLimits::default())?.nodes[0].rule,
        "b"
    );
    r.symbols.remove(1);
    assert_eq!(
        scene(&f, &r, &scope(&[0]), EngineLimits::default())?.nodes[0].rule,
        "c"
    );
    Ok(())
}
#[test]
fn each_engine_limit_fails_with_its_name() -> Result {
    let mut f = Fake::basic();
    f.seq("children", 0, &[1]);
    f.seq("pins", 0, &[2]);
    f.seq("rows", 0, &[3]);
    f.seq("links", 0, &[4]);
    f.seq("source", 4, &[2]);
    f.seq("target", 4, &[2]);
    for (name, limits) in [
        (
            "nodes",
            EngineLimits {
                nodes: 0,
                ..EngineLimits::default()
            },
        ),
        (
            "ports",
            EngineLimits {
                ports: 0,
                ..EngineLimits::default()
            },
        ),
        (
            "rows",
            EngineLimits {
                rows: 0,
                ..EngineLimits::default()
            },
        ),
        (
            "edges",
            EngineLimits {
                edges: 0,
                ..EngineLimits::default()
            },
        ),
        (
            "depth",
            EngineLimits {
                depth: 0,
                ..EngineLimits::default()
            },
        ),
        (
            "function-call work units",
            EngineLimits {
                function_work: 0,
                ..EngineLimits::default()
            },
        ),
    ] {
        let error = scene(&f, &rules()?, &scope(&[0]), limits)
            .err()
            .ok_or("Expected limit failure")?;
        assert!(error.0.contains(name), "{error}");
    }
    Ok(())
}
#[test]
fn output_is_byte_identical_and_wire_validation_catches_bad_sides() -> Result {
    let mut f = Fake::basic();
    f.seq("pins", 0, &[2]);
    let r = rules()?;
    let a = scene(&f, &r, &scope(&[0]), EngineLimits::default())?;
    let b = scene(&f, &r, &scope(&[0]), EngineLimits::default())?;
    assert_eq!(serde_json::to_vec(&a)?, serde_json::to_vec(&b)?);
    let mut bad = r;
    bad.symbols[1].side = Some(intersect_views::Slot::Text {
        text: "MIDDLE".into(),
    });
    assert!(scene(&f, &bad, &scope(&[0]), EngineLimits::default()).is_err());
    Ok(())
}
#[test]
fn duplicate_rules_and_provider_errors_are_not_silently_ignored() -> Result {
    let f = Fake::basic();
    let mut r = rules()?;
    r.symbols.push(r.symbols[0].clone());
    assert!(scene(&f, &r, &scope(&[0]), EngineLimits::default()).is_err());
    let mut r = rules()?;
    r.symbols[0].title = Some(intersect_views::LabelRule::Scalar(
        intersect_views::Slot::Function("missing".into()),
    ));
    assert!(
        scene(&f, &r, &scope(&[0]), EngineLimits::default())
            .err()
            .ok_or("Expected provider failure")?
            .0
            .contains("missing")
    );
    Ok(())
}

#[test]
fn regions_and_structured_label_rules_are_deterministic_and_occurrence_scoped() -> Result {
    let mut f = Fake::basic();
    f.classes = vec!["Box", "Box", "Group", "Box", "Pin", "Link"];
    for owner in [0, 1] {
        f.seq("groups", owner, &[2, 2]);
        f.seq("links", owner, &[5]);
    }
    f.seq("members", 2, &[3, 3]);
    f.seq("pins", 3, &[4]);
    f.seq("source", 5, &[2, 3, 4]);
    f.seq("target", 5, &[2, 3]);
    f.seq("subject", 0, &[2]);
    let mut r = rules()?;
    r.symbols[0].regions = Some(serde_json::from_value(
        json!({"id":"regions","direction":"row","select":"groups","label":"label","children":{"select":"members"}}),
    )?);
    r.symbols[0].title = Some(serde_json::from_value(
        json!({"parts":[{"id":"self","subject":{"kind":"self"},"text":"label"},{"id":"other","subject":{"kind":"select","select":"subject"},"text":"label"},{"id":"hidden","subject":{"kind":"self"},"when":"deny","text":{"text":"hidden"}},{"id":"empty","subject":{"kind":"none"},"text":{"text":""}}]}),
    )?);
    let a = scene(&f, &r, &scope(&[0, 1]), EngineLimits::default())?;
    assert_eq!(
        serde_json::to_vec(&a)?,
        serde_json::to_vec(&scene(&f, &r, &scope(&[0, 1]), EngineLimits::default())?)?
    );
    let region = &a.nodes[0].regions.as_ref().ok_or("No regions")?.items[0];
    assert_eq!(region.children.len(), 1);
    assert_eq!(region.binding.context, vec!["e:0"]);
    assert_eq!(region.children[0].binding.context, vec!["e:0", "e:2"]);
    assert_eq!(a.edges[0].source, region.children[0].ports[0].id);
    assert_eq!(a.nodes[0].title.parts.len(), 3);
    assert_eq!(a.nodes[1].title.parts.len(), 2);
    assert!(a.nodes[0].title.parts[2].binding.is_none());
    let mut collapsed = scope(&[0, 1]);
    collapsed.ops.push(intersect_views::ScopeOp::Collapse {
        element: "e:2".into(),
        context: vec!["e:0".into()],
    });
    let b = scene(&f, &r, &collapsed, EngineLimits::default())?;
    assert!(
        b.nodes[0].regions.as_ref().ok_or("No regions")?.items[0]
            .children
            .is_empty()
    );
    assert_eq!(
        b.nodes[1].regions.as_ref().ok_or("No regions")?.items[0]
            .children
            .len(),
        1
    );
    assert_eq!(b.edges.len(), 2);
    assert_eq!(b.endpoint_proxies.len(), 2);
    assert!(
        b.endpoint_proxies
            .iter()
            .all(|p| p.display_owner == region.id)
    );
    f.seq("subject", 0, &[2, 2]);
    assert!(
        scene(&f, &r, &scope(&[0]), EngineLimits::default())
            .err()
            .ok_or("No cardinality error")?
            .0
            .contains("Cardinality")
    );
    f.seq("subject", 0, &[2]);
    f.seq("children", 0, &[3]);
    assert!(
        scene(&f, &r, &scope(&[0]), EngineLimits::default())
            .err()
            .ok_or("No membership error")?
            .0
            .contains("membership")
    );
    Ok(())
}
#[test]
fn region_limits_fail_without_truncation() -> Result {
    let mut f = Fake::basic();
    f.classes = vec!["Box"; 300];
    let mut r = rules()?;
    r.symbols[0].regions = Some(serde_json::from_value(
        json!({"id":"regions","direction":"column","select":"groups","label":"label","children":{"select":"members"}}),
    )?);
    f.seq("groups", 0, &(1..18).collect::<Vec<_>>());
    assert!(
        scene(&f, &r, &scope(&[0]), EngineLimits::default())
            .err()
            .ok_or("No region limit")?
            .0
            .contains("regions")
    );
    for i in 0..18 {
        f.seq("groups", i, &(100..116).collect::<Vec<_>>());
    }
    assert!(
        scene(
            &f,
            &r,
            &scope(&(0..18).collect::<Vec<_>>()),
            EngineLimits::default()
        )
        .err()
        .ok_or("No total region limit")?
        .0
        .contains("regions")
    );
    Ok(())
}

#[test]
fn label_hashes_use_the_exact_occurrence_subject_binding_key() -> Result {
    let mut f = Fake::basic();
    f.context_keys = true;
    f.seq("children", 0, &[5]);
    let r = rules()?;
    let s = scene(&f, &r, &scope(&[0]), EngineLimits::default())?;
    let child = &s.nodes[0].children[0];
    let p = &child.title.parts[0];
    let subject = p.binding.as_ref().ok_or("No binding")?;
    assert_ne!(subject.key, "e:5");
    assert_eq!(
        p.id,
        intersect_view_engine::graph::part_id(
            "view",
            &r.id,
            &child.id,
            "node.title",
            "__legacy",
            Some(&subject.key)
        )?
    );
    Ok(())
}

#[test]
fn containment_projection_preserves_repeated_contexts_and_charges_relationships() -> Result {
    let mut f = Fake::basic();
    f.classes.push("Box");
    f.seq("children", 0, &[5]);
    f.seq("children", 1, &[5]);
    f.seq("children", 5, &[6]);
    let mut r = rules()?;
    r.edges.clear();
    let nested = scene(&f, &r, &scope(&[0, 1]), EngineLimits::default())?;
    r.projection = intersect_views::ProjectionPolicy::ContainmentTree {
        edge_role: "part-child".into(),
        edge_notation: "line".into(),
    };
    let tree = scene(&f, &r, &scope(&[0, 1]), EngineLimits::default())?;
    assert_eq!(tree.nodes.len(), 6);
    assert_eq!(tree.edges.len(), 4);
    let original = [
        &nested.nodes[0],
        &nested.nodes[0].children[0],
        &nested.nodes[0].children[0].children[0],
        &nested.nodes[1],
        &nested.nodes[1].children[0],
        &nested.nodes[1].children[0].children[0],
    ];
    for (flat, nested) in tree.nodes.iter().zip(original) {
        assert!(flat.children.is_empty());
        assert_eq!(flat.id, nested.id);
        assert_eq!(
            serde_json::to_value(&flat.binding)?,
            serde_json::to_value(&nested.binding)?
        );
        assert_eq!(
            serde_json::to_value(&flat.ports)?,
            serde_json::to_value(&nested.ports)?
        );
        assert_eq!(
            serde_json::to_value(&flat.compartments)?,
            serde_json::to_value(&nested.compartments)?
        );
    }
    for (edge, (parent, child)) in tree.edges.iter().zip([(0, 1), (1, 2), (3, 4), (4, 5)]) {
        assert_eq!(edge.source, tree.nodes[parent].id);
        assert_eq!(edge.target, tree.nodes[child].id);
        assert_eq!(
            serde_json::to_value(&edge.binding)?,
            serde_json::to_value(&tree.nodes[child].binding)?
        );
    }
    assert_ne!(tree.edges[0].id, tree.edges[2].id);
    assert!(scene(&f, &r, &scope(&[2]), EngineLimits::default()).is_err());
    let reordered = scene(&f, &r, &scope(&[1, 0]), EngineLimits::default())?;
    assert_eq!(
        tree.edges.iter().map(|e| &e.id).collect::<BTreeSet<_>>(),
        reordered.edges.iter().map(|e| &e.id).collect()
    );
    assert!(
        scene(
            &f,
            &r,
            &scope(&[0, 1]),
            EngineLimits {
                edges: 3,
                ..EngineLimits::default()
            }
        )
        .is_err()
    );
    Ok(())
}
