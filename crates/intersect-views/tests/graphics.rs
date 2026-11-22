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
