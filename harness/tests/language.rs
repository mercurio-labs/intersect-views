use intersect_model::{
    core::{
        frozen::{Model, Obj, Severity},
        query::QueryBudget,
    },
    definitions::rcore_behavior::ir_v2::{DataWire, Effect, Limits},
    rcore::ExecutionLimits,
    source_model_functions::SourceModelFunction,
};
use intersect_view_harness::{
    SOURCE_LIMITS, Source, VIEW_FUNCTIONS, function_store, load, selection, view_source,
    with_definition,
};

fn named<'a>(model: &'a Model, name: &str) -> Result<Obj<'a>, String> {
    model
        .objects()
        .find(|obj| obj.feature("name").and_then(|f| obj.str(f)) == Some(name))
        .ok_or_else(|| format!("Missing {name}"))
}
fn target<'a>(obj: Obj<'a>, feature: &str) -> Result<Obj<'a>, String> {
    obj.refs(
        obj.feature(feature)
            .ok_or_else(|| format!("Missing feature {feature}"))?,
    )
    .next()
    .ok_or_else(|| format!("Missing target {feature}"))
}
#[test]
fn bundled_view_documents_obey_the_shared_contracts() -> Result<(), String> {
    let rules: intersect_views::RuleSet =
        serde_json::from_str(include_str!("../views/structure.viewrules.json"))
            .map_err(|e| e.to_string())?;
    rules.validate()?;
    let view: intersect_views::ViewDocument =
        serde_json::from_str(include_str!("../models/structure.view.json"))
            .map_err(|e| e.to_string())?;
    view.validate()?;
    assert_eq!(view.rule_set, rules.id());
    let palette: intersect_views::Palette =
        serde_json::from_str(include_str!("../views/harness.palette.json"))
            .map_err(|e| e.to_string())?;
    palette.validate()?;
    Ok(())
}
#[test]
fn full_language_links_contextual_pins_and_evaluates_every_view_slot() -> Result<(), String> {
    with_definition(|definition| {
        let loaded = load(
            definition,
            &[Source {
                uri: "structure.harness".into(),
                text: include_str!("../models/structure.harness").into(),
            }],
        )?;
        assert!(loaded.issues.is_empty(), "{:?}", loaded.issues);
        assert_eq!(loaded.proxies, 9);
        assert_eq!(loaded.unresolved_occurrences, 9);
        let model = &loaded.model;
        let alpha = named(model, "Alpha")?;
        let beta = named(model, "Beta")?;
        assert_eq!(target(alpha, "kind")?.id(), target(beta, "kind")?.id());
        for (end, part, pin) in [("s1", "Nested", "outbound"), ("s2", "Local", "outgoing")] {
            let end = named(model, end)?;
            assert_eq!(target(end, "part")?.id(), named(model, part)?.id());
            assert_eq!(target(end, "pin")?.id(), named(model, pin)?.id());
        }
        // Equal spellings under sibling parts resolve using End.part.
        let t2 = named(model, "t2")?;
        assert_eq!(target(t2, "part")?.id(), named(model, "Mirror")?.id());
        assert_eq!(
            target(t2, "pin")?
                .container()
                .ok_or("Pin lacks owner")?
                .0
                .id(),
            named(model, "Mirror")?.id()
        );
        assert_ne!(
            target(named(model, "s2")?, "pin")?.id(),
            target(t2, "pin")?.id()
        );
        let store = function_store(model.clone())?;
        let source = view_source(definition, VIEW_FUNCTIONS);
        let cases = [
            ("boxFields", "Alpha", vec!["local", "inherited"]),
            ("boxFields", "Beta", vec!["inherited"]),
            ("boxPins", "Alpha", vec!["incoming", "boundary"]),
            ("boxParts", "Alpha", vec!["Local", "Mirror", "Nested"]),
            ("boxParts", "Beta", vec!["Nested"]),
            ("boxLinks", "Alpha", vec!["wire", "inheritedWire"]),
            ("boxKindRef", "Alpha", vec!["Shared"]),
            ("linkedBoxes", "Alpha", vec!["Mirror"]),
            ("linkSourcePath", "wire", vec!["Local", "outgoing"]),
            ("linkTargetPath", "wire", vec!["Mirror", "outgoing"]),
        ];
        let mut budget = QueryBudget::new(10_000_000);
        for (name, owner, expected) in cases {
            let function = SourceModelFunction::from_prepared(
                definition,
                vec![source.clone()],
                &selection(definition, &source, name)?,
                &Limits::default(),
                ExecutionLimits::default(),
                SOURCE_LIMITS,
            )?;
            assert_ne!(
                function
                    .executable()
                    .function_effect(function.executable().program().entry)
                    .map_err(|e| e.to_string())?,
                Effect::Construct
            );
            let result = function.invoke_model(
                &store,
                named(model, owner)?.identity(),
                vec![],
                &mut budget,
            )?;
            let DataWire::Collection(items) = result.data else {
                return Err(format!("Expected sequence from {name}"));
            };
            let actual: Result<Vec<_>, String> = items
                .into_iter()
                .map(|item| {
                    let DataWire::Model(json) = item.data else {
                        return Err("Expected model identity".into());
                    };
                    let obj = model
                        .lookup(json["element"].as_str().ok_or("Missing element")?)
                        .ok_or("Unknown element")?;
                    Ok(obj
                        .str(obj.feature("name").ok_or("Missing name")?)
                        .ok_or("Missing name value")?
                        .to_owned())
                })
                .collect();
            assert_eq!(actual?, expected, "{name}({owner})");
        }
        for (name, owner, expected) in [
            ("boxTitle", "Alpha", "Alpha"),
            ("boxKind", "Alpha", "Shared"),
            ("boxStyle", "Alpha", "critical"),
            ("fieldLabel", "local", "local"),
            ("pinLabel", "incoming", "incoming"),
            ("pinSide", "incoming", "WEST"),
            ("pinSide", "boundary", "EAST"),
            ("linkLabel", "wire", "wire"),
        ] {
            let function = SourceModelFunction::from_prepared(
                definition,
                vec![source.clone()],
                &selection(definition, &source, name)?,
                &Limits::default(),
                ExecutionLimits::default(),
                SOURCE_LIMITS,
            )?;
            let result = function.invoke_model(
                &store,
                named(model, owner)?.identity(),
                vec![],
                &mut budget,
            )?;
            let DataWire::Scalar(value) = result.data else {
                return Err("Expected scalar".into());
            };
            assert_eq!(value.payload, serde_json::json!(expected), "{name}");
        }
        Ok(())
    })
}
#[test]
fn one_located_issue_for_each_invalid_validation_fixture() -> Result<(), String> {
    with_definition(|definition| {
        for (name, text, code, owner, feature) in [
            (
                "invalid-same-ends.harness",
                include_str!("../models/invalid-same-ends.harness"),
                "harness.link.ends",
                "same",
                "target",
            ),
            (
                "invalid-empty-end.harness",
                include_str!("../models/invalid-empty-end.harness"),
                "harness.end.target",
                "s",
                "part",
            ),
            (
                "invalid-pin-owner.harness",
                include_str!("../models/invalid-pin-owner.harness"),
                "harness.end.owner",
                "s",
                "pin",
            ),
            (
                "invalid-duplicate-name.harness",
                include_str!("../models/invalid-duplicate-name.harness"),
                "harness.names.unique",
                "Owner",
                "name",
            ),
        ] {
            let loaded = load(
                definition,
                &[Source {
                    uri: name.into(),
                    text: text.into(),
                }],
            )?;
            assert_eq!(loaded.issues.len(), 1, "{name}: {:?}", loaded.issues);
            let found = &loaded.issues[0];
            assert_eq!(found.issue.code, code);
            assert_eq!(found.issue.severity, Severity::Error);
            assert_eq!(found.issue.feature.as_deref(), Some(feature));
            assert!(!found.issue.message.is_empty());
            let object = loaded
                .model
                .obj(found.object)
                .ok_or("Missing issue object")?;
            assert_eq!(object.id(), named(&loaded.model, owner)?.id());
            assert_eq!(object.resource(), name);
            let (start, end) = object.span();
            assert!(
                start < end && end <= text.len(),
                "{name}: invalid located span {start}..{end}"
            );
            assert!(
                text.get(start..end)
                    .ok_or("Invalid source range")?
                    .contains(owner)
            );
        }
        Ok(())
    })
}
