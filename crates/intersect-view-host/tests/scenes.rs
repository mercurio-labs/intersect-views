use intersect_view_host::{Host, NoCommands};
use intersect_views::SceneResponse;
use serde_json::{Value, json};
type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error>>;
#[test]
fn public_function_indexing_accepts_explicit_source_limits_and_remains_bounded() -> Result {
    for (padding, accepted) in [(270_000, true), (1_000_001, false)] {
        let mut language = intersect_view_harness::definition();
        let module = language.view_functions.last_mut().ok_or("No view module")?;
        let mut source = intersect_model::definitions::bundle::DefinitionSource::new(
            &module.id.uri,
            module.kind,
            format!("{}\n// {}\n", module.text, "x".repeat(padding)),
        );
        source.dependencies = module.dependencies.clone();
        *module = source;
        let created = Host::new(language, Box::new(NoCommands));
        if !accepted {
            assert!(
                created
                    .err()
                    .ok_or("Oversized module accepted")?
                    .contains("size budget")
            );
            continue;
        }
        let mut host = created?;
        let analysis = call(
            &mut host,
            "workspace/analyze",
            json!({"revision":1,"sources":[
                {"uri":"model.harness","text":"space Project { box Alpha {} }"},
                {"uri":"structure.view.json","text":include_str!("../../../harness/models/structure.view.json")}
            ]}),
        )?;
        assert_eq!(analysis["clean"], true);
        let catalog = host.view_catalog(1)?;
        let alpha = catalog.views[0]
            .owners
            .iter()
            .find(|o| o.label == "Alpha")
            .ok_or("No Alpha")?;
        let scope = serde_json::from_value(
            json!({"schemaVersion":1,"ops":[{"op":"addSeed","element":alpha.key}]}),
        )?;
        let scene = host.view_scene(1, "structure-1", Some(&scope), None)?;
        assert_eq!(scene.scene.graph()?.nodes[0].title, "Alpha");
        scene.validate()?;
    }
    Ok(())
}
#[test]
fn creation_and_connection_predicates_must_exist_and_return_bool() -> Result {
    for pointer in [
        "/symbols/0/create/0/accepts",
        "/edges/0/connect/sourceAccepts",
        "/edges/0/connect/targetAccepts",
    ] {
        for name in ["missingPredicate", "boxTitle"] {
            let mut language = intersect_view_harness::definition();
            let mut rules: Value = serde_json::from_str(&language.rule_sets[0])?;
            *rules.pointer_mut(pointer).ok_or("No predicate slot")? = json!(name);
            language.rule_sets[0] = serde_json::to_string(&rules)?;
            let error = Host::new(language, Box::new(NoCommands))
                .err()
                .ok_or("Invalid predicate accepted")?;
            assert!(error.contains(name), "{error}");
        }
    }
    Ok(())
}
fn call(host: &mut Host, method: &str, params: Value) -> Result<Value> {
    Ok(host.dispatch(json!({"method":method,"params":params}))?)
}
pub fn scene() -> Result<Value> {
    let mut host = Host::new(intersect_view_harness::definition(), Box::new(NoCommands))?;
    let analysis = call(
        &mut host,
        "workspace/analyze",
        json!({"revision":1,"sources":[
        {"uri":"structure.harness","text":include_str!("../../../harness/models/structure.harness")},
        {"uri":"structure.view.json","text":include_str!("../../../harness/models/structure.view.json")},
        {"uri":"invalid.view.json","text":"{}"}]}),
    )?;
    assert_eq!(analysis["clean"], true);
    let catalog = call(&mut host, "views/catalog", json!({"revision":1}))?;
    assert_eq!(catalog["views"].as_array().ok_or("No views")?.len(), 1);
    let view = &catalog["views"][0];
    let owners = view["owners"].as_array().ok_or("No owners")?;
    let key = |name: &str| -> Result<Value> {
        Ok(owners
            .iter()
            .find(|o| o["label"] == name)
            .ok_or("No owner")?["key"]
            .clone())
    };
    let params = json!({"revision":1,"viewKey":view["key"],"scope":{"schemaVersion":1,"ops":[{"op":"addSeed","element":key("Alpha")?},{"op":"addSeed","element":key("Beta")?}]}});
    let response = call(&mut host, "views/scene", params.clone())?;
    let typed: SceneResponse = serde_json::from_value(response.clone())?;
    typed.validate()?;
    assert_eq!(typed.scene.graph()?.nodes.len(), 2);
    let graph = typed.scene.graph()?;
    let nested = |i: usize| {
        graph.nodes[i]
            .children
            .iter()
            .find(|n| n.title == "Nested")
            .ok_or("No Nested")
    };
    let (a, b) = (nested(0)?, nested(1)?);
    assert_ne!(a.id, b.id);
    assert_eq!(a.binding.key, b.binding.key);
    let inherited: Vec<_> = typed
        .scene
        .graph()?
        .edges
        .iter()
        .filter(|e| e.label == "inheritedWire")
        .collect();
    assert_eq!(inherited.len(), 2);
    assert_ne!(inherited[0].source, inherited[1].source);
    assert_ne!(inherited[0].target, inherited[1].target);
    assert_eq!(inherited[0].source, a.ports[0].id);
    assert_eq!(inherited[1].source, b.ports[0].id);
    assert_eq!(
        serde_json::to_vec(&response)?,
        serde_json::to_vec(&call(&mut host, "views/scene", params)?)?
    );
    assert!(
        host.dispatch(
            json!({"method":"views/scene","params":{"revision":0,"viewKey":view["key"]}})
        )
        .is_err()
    );
    let empty = call(
        &mut host,
        "views/scene",
        json!({"revision":1,"viewKey":view["key"]}),
    )?;
    assert_eq!(empty["scene"]["nodes"], json!([]));
    assert_eq!(
        call(&mut host, "views/ruleSets", json!({}))?["ruleSets"][0]["id"],
        "harness.structure"
    );
    assert!(call(&mut host, "views/notation", json!({}))?.is_object());
    Ok(response)
}
#[test]
fn project_catalog_cached_functions_and_occurrence_edges() -> Result {
    scene()?;
    Ok(())
}
#[test]
fn exploration_override_can_be_saved_and_reloaded() -> Result {
    let original = scene()?;
    let alpha = &original["scene"]["nodes"][0]["binding"]["key"];
    let scope = json!({"schemaVersion":1,"ops":[{"op":"addSeed","element":alpha},{"op":"expand","element":alpha,"relation":"linked","hops":1},{"op":"collapse","element":alpha,"context":[]}]});
    let mut doc: Value =
        serde_json::from_str(include_str!("../../../harness/models/structure.view.json"))?;
    let mut host = Host::new(intersect_view_harness::definition(), Box::new(NoCommands))?;
    let analyze = |host: &mut Host, doc: &Value| -> Result<Value> {
        call(
            host,
            "workspace/analyze",
            json!({"revision":2,"sources":[{"uri":"structure.harness","text":include_str!("../../../harness/models/structure.harness")},{"uri":"structure.view.json","text":serde_json::to_string(doc)?}]}),
        )
    };
    analyze(&mut host, &doc)?;
    let explored = call(
        &mut host,
        "views/scene",
        json!({"revision":2,"viewKey":doc["key"],"scope":scope}),
    )?;
    doc["scope"] = scope;
    analyze(&mut host, &doc)?;
    let saved = call(
        &mut host,
        "views/scene",
        json!({"revision":2,"viewKey":doc["key"]}),
    )?;
    assert_eq!(explored["scene"]["nodes"], saved["scene"]["nodes"]);
    assert_eq!(explored["scene"]["edges"], saved["scene"]["edges"]);
    assert_eq!(explored["scene"]["problems"], saved["scene"]["problems"]);
    Ok(())
}
#[test]
fn load_rejects_invalid_classes_functions_and_signatures() -> Result {
    for (pointer, value, expected) in [
        ("/symbols/0/match", json!("Unknown"), "class"),
        (
            "/symbols/0/title",
            json!("unknownFunction"),
            "unknownFunction",
        ),
        ("/symbols/0/title", json!("pinLabel"), "pinLabel"),
        ("/symbols/0/title", json!("boxFields"), "boxFields"),
    ] {
        let mut language = intersect_view_harness::definition();
        let mut rules: Value = serde_json::from_str(&language.rule_sets[0])?;
        *rules.pointer_mut(pointer).ok_or("No slot")? = value;
        language.rule_sets[0] = serde_json::to_string(&rules)?;
        let error = Host::new(language, Box::new(NoCommands))
            .err()
            .ok_or("Accepted invalid rules")?;
        assert!(
            error.to_lowercase().contains(&expected.to_lowercase()),
            "{error}"
        );
    }
    Ok(())
}
#[test]
fn load_refuses_constructing_function_effects_and_invalid_notation() -> Result {
    use intersect_model::definitions::bundle::DefinitionSource;
    let mut language = intersect_view_harness::definition();
    let source = &language.view_functions[1];
    let mut replacement = DefinitionSource::new(
        source.id.uri.clone(),
        source.kind,
        format!(
            "{}\npub fn badTitle(self:h.Box)->String {{ let field:h.Field = new h.Field {{ name:self.name, value:1 }}; field.name }}",
            source.text
        ),
    );
    replacement.dependencies = source.dependencies.clone();
    language.view_functions[1] = replacement;
    let mut rules: Value = serde_json::from_str(&language.rule_sets[0])?;
    rules["symbols"][0]["title"] = json!("badTitle");
    language.rule_sets[0] = serde_json::to_string(&rules)?;
    let error = Host::new(language, Box::new(NoCommands))
        .err()
        .ok_or("Construction accepted")?;
    assert!(error.contains("constructing"), "{error}");
    let mut language = intersect_view_harness::definition();
    language.notation =
        "{\"schemaVersion\":1,\"id\":\"bad\",\"shapes\":{},\"script\":\"no\"}".into();
    assert!(Host::new(language, Box::new(NoCommands)).is_err());
    Ok(())
}

fn invalid_m8_slot(pointer: &str, name: &str) -> Result {
    let mut d = intersect_view_harness::definition();
    let mut rules: Value = serde_json::from_str(&d.rule_sets[4])?;
    let (parent, key) = pointer.rsplit_once('/').ok_or("Bad pointer")?;
    rules
        .pointer_mut(parent)
        .and_then(Value::as_object_mut)
        .ok_or("No slot parent")?
        .insert(key.into(), json!(name));
    d.rule_sets[4] = rules.to_string();
    let error = Host::new(d, Box::new(NoCommands))
        .err()
        .ok_or("Invalid signature accepted")?;
    assert!(
        error.contains(name) || error.contains("kindTitle"),
        "{error}"
    );
    Ok(())
}
#[test]
fn m8_region_select_requires_elements() -> Result {
    invalid_m8_slot("/symbols/0/regions/select", "boxTitle")
}
#[test]
fn m8_label_select_checks_subject_class() -> Result {
    invalid_m8_slot("/symbols/0/title/parts/1/subject/select", "boxFields")
}
#[test]
fn m8_label_when_requires_bool() -> Result {
    invalid_m8_slot("/symbols/0/title/parts/0/when", "boxTitle")
}
#[test]
fn m8_label_edit_requires_bool() -> Result {
    invalid_m8_slot(
        "/symbols/0/compartments/0/rowLabel/parts/2/edit/accepts",
        "fieldBand",
    )
}

#[test]
fn language_vm_limits_are_enforced_on_scene_calls() -> Result {
    for limit in ["storage", "work"] {
        let mut language = intersect_view_harness::definition();
        if limit == "storage" {
            language.view_execution_limits.max_model_storage_bytes = 0;
        } else {
            language.view_function_work = 0;
        }
        let mut host = Host::new(language, Box::new(NoCommands))?;
        let analysis = call(
            &mut host,
            "workspace/analyze",
            json!({"revision":1,"sources":[
                {"uri":"model.harness","text":"space Project { box Alpha {} }"},
                {"uri":"structure.view.json","text":include_str!("../../../harness/models/structure.view.json")}
            ]}),
        )?;
        assert_eq!(analysis["clean"], true);
        let catalog = host.view_catalog(1)?;
        let alpha = catalog.views[0]
            .owners
            .iter()
            .find(|o| o.label == "Alpha")
            .ok_or("No Alpha")?;
        let scope = serde_json::from_value(
            json!({"schemaVersion":1,"ops":[{"op":"addSeed","element":alpha.key}]}),
        )?;
        let error = host
            .view_scene(1, "structure-1", Some(&scope), None)
            .err()
            .ok_or("VM limit ignored")?;
        assert!(error.contains(limit), "{error}");
    }
    Ok(())
}
