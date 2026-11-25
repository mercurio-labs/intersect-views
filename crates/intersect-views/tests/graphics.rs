use intersect_views::{GraphicDefinitions, GraphicInstance, GraphicRole, SymbolLibrary};
use serde_json::Value;
type Result = std::result::Result<(), Box<dyn std::error::Error>>;

#[test]
fn shared_graphic_contract_vectors() -> Result {
    let vectors: Value = serde_json::from_str(include_str!("fixtures/graphics-v1.json"))?;
    for vector in vectors["accepted"]
        .as_array()
        .ok_or("Missing accepted vectors")?
    {
        let libraries: Vec<SymbolLibrary> = serde_json::from_value(vector["libraries"].clone())?;
        GraphicDefinitions::new(&libraries).map_err(|e| format!("{}: {e}", vector["name"]))?;
    }
    for vector in vectors["rejected"]
        .as_array()
        .ok_or("Missing rejected vectors")?
    {
        let result = serde_json::from_value::<Vec<SymbolLibrary>>(vector["libraries"].clone())
            .map_err(|e| e.to_string())
            .and_then(|libraries| GraphicDefinitions::new(&libraries).map(|_| ()));
        assert!(result.is_err(), "Accepted {}", vector["name"]);
    }
    Ok(())
}

#[test]
fn border_anchor_is_an_anchor_of_a_port_symbol_and_needs_its_capability() -> Result {
    let library: Value = serde_json::from_str(include_str!(
        "../../../harness/views/symbols/classic.symbols.json"
    ))?;
    let definitions = library["definitions"]
        .as_array()
        .ok_or("Missing definitions")?;
    let port = definitions
        .iter()
        .position(|d| d["role"] == "port")
        .ok_or("No port symbol")?;
    let node = definitions
        .iter()
        .position(|d| d["role"] == "node")
        .ok_or("No node symbol")?;
    let check = |index: usize, anchor: Value| -> std::result::Result<SymbolLibrary, String> {
        let mut library = library.clone();
        library["definitions"][index]["borderAnchor"] = anchor;
        let library: SymbolLibrary = serde_json::from_value(library).map_err(|e| e.to_string())?;
        GraphicDefinitions::new(std::slice::from_ref(&library))?;
        Ok(library)
    };
    let connection = library["definitions"][port]["connectionAnchor"].clone();
    let accepted = check(port, connection.clone())?;
    assert!(
        intersect_views::require_border_anchor_capability(
            &accepted,
            &["graphics.composition.v1".into()]
        )
        .is_err()
    );
    intersect_views::require_border_anchor_capability(
        &accepted,
        &["graphics.borderAnchor.v1".into()],
    )?;
    assert_eq!(
        check(port, "absent".into()).err().as_deref(),
        Some("Missing border anchor")
    );
    assert!(
        check(node, connection)
            .err()
            .is_some_and(|e| e.ends_with("Only a port symbol has a border anchor"))
    );
    // A library without the field needs no capability and serializes as before.
    let plain: SymbolLibrary = serde_json::from_value(library.clone())?;
    intersect_views::require_border_anchor_capability(&plain, &[])?;
    assert!(!serde_json::to_string(&plain)?.contains("borderAnchor"));
    Ok(())
}

#[test]
fn evaluated_instance_checks_role_slots_and_choice() -> Result {
    let vectors: Value = serde_json::from_str(include_str!("fixtures/graphics-v1.json"))?;
    let libraries: Vec<SymbolLibrary> =
        serde_json::from_value(vectors["accepted"][0]["libraries"].clone())?;
    let definitions = GraphicDefinitions::new(&libraries)?;
    let value = serde_json::json!({
        "definition":"fixture.base/card",
        "parameters":{"fill":"#ffffff","ink":"#123456","enabled":true,"size":20,"mode":"b"},
        "slots":{"title":{"kind":"title"}}
    });
    let instance: GraphicInstance = serde_json::from_value(value.clone())?;
    definitions.instance(&instance, GraphicRole::Node)?;
    assert!(definitions.instance(&instance, GraphicRole::Port).is_err());
    let mut bad = value.clone();
    bad["parameters"]["mode"] = "c".into();
    assert!(
        definitions
            .instance(&serde_json::from_value(bad)?, GraphicRole::Node)
            .is_err()
    );
    let mut bad = value.clone();
    bad["parameters"]["fill"] = "url(https://example.test/paint)".into();
    assert!(
        definitions
            .instance(&serde_json::from_value(bad)?, GraphicRole::Node)
            .is_err()
    );
    let mut bad = value;
    bad["slots"]["title"] = serde_json::json!({"kind":"children"});
    assert!(
        definitions
            .instance(&serde_json::from_value(bad)?, GraphicRole::Node)
            .is_err()
    );
    Ok(())
}

#[test]
fn shared_graphics_limit_boundaries() -> Result {
    let vectors: Value = serde_json::from_str(include_str!("fixtures/graphics-limits-v1.json"))?;
    for accepted in [true, false] {
        for vector in vectors[if accepted { "accepted" } else { "rejected" }]
            .as_array()
            .ok_or("Missing limits")?
        {
            let result = serde_json::from_value::<Vec<SymbolLibrary>>(vector["libraries"].clone())
                .map_err(|e| e.to_string())
                .and_then(|libraries| GraphicDefinitions::new(&libraries).map(|_| ()));
            assert_eq!(result.is_ok(), accepted, "{}: {:?}", vector["name"], result);
        }
    }
    Ok(())
}
