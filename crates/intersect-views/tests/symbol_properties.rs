use intersect_views::*;
use serde_json::Value;
#[test]
fn shared_visual_property_contract_vectors() {
    let cases: Value =
        serde_json::from_str(include_str!("fixtures/symbol-properties-v1.json")).unwrap();
    for case in cases.as_array().unwrap() {
        let accepted = serde_json::from_value::<SymbolLibrary>(case["library"].clone())
            .and_then(|library| {
                GraphicDefinitions::new(&[library])
                    .map(|_| ())
                    .map_err(serde::de::Error::custom)
            })
            .is_ok();
        assert_eq!(
            accepted,
            case["accepted"].as_bool().unwrap(),
            "{}",
            case["name"]
        );
    }
}
#[test]
fn source_provenance_and_evaluated_bounds_are_checked() {
    let libraries: Vec<SymbolLibrary> = vec![
        serde_json::from_str(include_str!("fixtures/symbol-properties-library.json")).unwrap(),
    ];
    let defs = GraphicDefinitions::new(&libraries).unwrap();
    let d = &libraries[0].definitions[0];
    let mut instance:GraphicInstance=serde_json::from_value(serde_json::json!({"definition":d.id,"parameters":d.parameters.iter().map(|(k,p)|(k.clone(),p.default_value())).collect::<std::collections::BTreeMap<_,_>>(),"slots":{"title":{"kind":"title"}},"sourceParameters":[]})).unwrap();
    assert!(defs.instance(&instance, GraphicRole::Node).is_ok());
    instance
        .parameters
        .insert("fontSize".into(), GraphicValue::Number(100.0));
    assert!(defs.instance(&instance, GraphicRole::Node).is_err());
    instance
        .parameters
        .insert("fontSize".into(), GraphicValue::Number(14.0));
    instance.source_parameters = Some(vec!["foreign".into()]);
    assert!(defs.instance(&instance, GraphicRole::Node).is_err());
}

#[test]
fn shared_v5_persistence_vectors() {
    let cases: Value =
        serde_json::from_str(include_str!("fixtures/symbol-presentation-v5.json")).unwrap();
    for case in cases.as_array().unwrap() {
        let accepted = serde_json::from_value::<Presentation>(case["value"].clone())
            .is_ok_and(|p| p.validate().is_ok());
        assert_eq!(
            accepted,
            case["accepted"].as_bool().unwrap(),
            "{}",
            case["name"]
        );
    }
}

#[test]
fn empty_override_targets_still_consume_the_byte_budget() {
    let targets = (0..5000)
        .map(|i| (format!("{}{}", "a".repeat(250), i), Default::default()))
        .collect();
    assert!(validate_symbol_overrides(&targets).is_err());
}
