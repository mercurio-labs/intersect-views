use intersect_view_host::{Host, NoCommands};
use intersect_views::{GraphicValue, SceneResponse};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error>>;
fn hash(text: &str) -> String {
    format!("{:x}", Sha256::digest(text.as_bytes()))
}
#[test]
fn m12_shared_exact_byte_package_vectors() -> Result {
    let vectors: Value = serde_json::from_str(include_str!(
        "../../intersect-views/tests/fixtures/presentation-package-v1.json"
    ))?;
    let language = vectors["language"].as_str().ok_or("No language")?;
    let fingerprint = vectors["languageFingerprint"]
        .as_str()
        .ok_or("No fingerprint")?;
    for vector in vectors["accepted"]
        .as_array()
        .ok_or("No accepted vectors")?
    {
        let input: intersect_views::PresentationInput =
            serde_json::from_value(vector["input"].clone())?;
        let resolved = input.resolve(language, fingerprint, &|bytes| {
            format!("{:x}", Sha256::digest(bytes))
        })?;
        assert_eq!(
            resolved.fingerprint, vector["fingerprint"],
            "{}",
            vector["name"]
        );
    }
    for vector in vectors["rejected"]
        .as_array()
        .ok_or("No rejected vectors")?
    {
        let result =
            serde_json::from_value::<intersect_views::PresentationInput>(vector["input"].clone())
                .map_err(|e| e.to_string())
                .and_then(|input| {
                    input
                        .resolve(language, fingerprint, &|bytes| {
                            format!("{:x}", Sha256::digest(bytes))
                        })
                        .map(|_| ())
                });
        assert!(result.is_err(), "Accepted {}", vector["name"]);
    }
    Ok(())
}
#[test]
fn m12_independent_graphics_libraries_admit_without_new_host_code() -> Result {
    for library in [
        include_str!("../../../harness/views/symbols/sysml.symbols.json"),
        include_str!("../../../harness/views/symbols/electrical.symbols.json"),
        include_str!("../../../harness/views/symbols/fault.symbols.json"),
    ] {
        let mut host = Host::new(intersect_view_harness::definition(), Box::new(NoCommands))?;
        let initialized = call(&mut host, "initialize", json!({"protocolVersion":2}))?;
        let mut candidate = input(
            initialized["language"]["fingerprint"]
                .as_str()
                .ok_or("No fingerprint")?,
            false,
        );
        let parsed: Value = serde_json::from_str(library)?;
        let namespace = parsed["id"].as_str().ok_or("No library ID")?;
        candidate["resources"][0]["content"] = library.into();
        candidate["resources"][1]["content"] =
            include_str!("../../../harness/views/symbols/symbols.viewrules.json")
                .replace("harness.symbols/", &format!("{namespace}/"))
                .into();
        for i in 0..3 {
            candidate["manifests"][0]["resources"][i]["sha256"] = hash(
                candidate["resources"][i]["content"]
                    .as_str()
                    .ok_or("No resource content")?,
            )
            .into();
        }
        call(&mut host, "views/preparePresentation", candidate)?;
        let response = scene(&mut host)?;
        response.validate()?;
        assert_eq!(response.scene.graph()?.nodes.len(), 2);
        assert_eq!(response.presentation.libraries[0].id, namespace);
    }
    Ok(())
}
#[test]
fn m12_nested_content_slots_keep_region_occurrences_and_endpoints() -> Result {
    let mut host = Host::new(intersect_view_harness::definition(), Box::new(NoCommands))?;
    let initialized = call(&mut host, "initialize", json!({"protocolVersion":2}))?;
    let mut candidate = input(
        initialized["language"]["fingerprint"]
            .as_str()
            .ok_or("No fingerprint")?,
        false,
    );
    candidate["resources"][0]["content"] =
        include_str!("../../../harness/views/symbols/containers.symbols.json").into();
    candidate["resources"][1]["content"] =
        include_str!("../../../harness/views/symbols/containers.viewrules.json")
            .replace("harness.symbols/", "example.containers/")
            .into();
    for i in 0..3 {
        candidate["manifests"][0]["resources"][i]["sha256"] = hash(
            candidate["resources"][i]["content"]
                .as_str()
                .ok_or("No resource")?,
        )
        .into();
    }
    call(&mut host, "views/preparePresentation", candidate)?;
    let response = scene_with_model(
        &mut host,
        include_str!("../../../harness/models/regions.harness"),
    )?;
    response.validate()?;
    let graph = response.scene.graph()?;
    assert!(graph.problems.is_empty(), "{:?}", graph.problems);
    let a = graph.nodes[0].regions.as_ref().ok_or("Missing regions")?;
    let b = graph.nodes[1].regions.as_ref().ok_or("Missing regions")?;
    assert_eq!(a.items.len(), 2);
    assert_eq!(b.items.len(), 2);
    assert_eq!(a.items[0].binding.key, b.items[0].binding.key);
    assert_ne!(a.items[0].binding.context, b.items[0].binding.context);
    assert_eq!(graph.edges.len(), 2);
    for edge in &graph.edges {
        assert!(
            graph
                .nodes
                .iter()
                .any(|n| n.regions.as_ref().is_some_and(|rs| rs
                    .items
                    .iter()
                    .flat_map(|r| &r.children)
                    .flat_map(|c| &c.ports)
                    .any(|p| p.id == edge.source)))
        );
    }
    Ok(())
}
fn call(host: &mut Host, method: &str, params: Value) -> Result<Value> {
    Ok(host.dispatch(json!({"method":method,"params":params}))?)
}
fn input(fingerprint: &str, rotated: bool) -> Value {
    let resources = [
        (
            "symbols",
            "symbolLibrary",
            if rotated {
                include_str!("../../../harness/views/symbols/rotated.symbols.json")
            } else {
                include_str!("../../../harness/views/symbols/classic.symbols.json")
            },
        ),
        (
            "rules",
            "ruleSet",
            include_str!("../../../harness/views/symbols/symbols.viewrules.json"),
        ),
        (
            "palette",
            "palette",
            include_str!("../../../harness/views/symbols/symbols.palette.json"),
        ),
    ];
    json!({"root":"harness.symbols@1","manifests":[{"schemaVersion":1,"id":"harness.symbols","version":"1","language":"urn:intersect:harness:1","languageFingerprint":fingerprint,"requires":["graphics.composition.v1","graphics.text.v1","graphics.anchors.v1","rules.graph.v8","views.routing.v1","views.labelPlacement.v1"],"dependencies":[],"resources":resources.iter().map(|(id,kind,content)|json!({"id":id,"kind":kind,"sha256":hash(content)})).collect::<Vec<_>>()}],"resources":resources.iter().map(|(id,_,content)|json!({"id":id,"content":content})).collect::<Vec<_>>()})
}
fn prepared(rotated: bool) -> Result<(Host, String)> {
    let mut host = Host::new(intersect_view_harness::definition(), Box::new(NoCommands))?;
    let init = call(&mut host, "initialize", json!({"protocolVersion":2}))?;
    let fingerprint = init["language"]["fingerprint"]
        .as_str()
        .ok_or("Missing language fingerprint")?;
    let response = call(
        &mut host,
        "views/preparePresentation",
        input(fingerprint, rotated),
    )?;
    Ok((
        host,
        response["presentation"]["fingerprint"]
            .as_str()
            .ok_or("Missing package fingerprint")?
            .into(),
    ))
}
fn scene(host: &mut Host) -> Result<SceneResponse> {
    scene_with_model(
        host,
        include_str!("../../../harness/models/symbols.harness"),
    )
}
fn scene_with_model(host: &mut Host, model: &str) -> Result<SceneResponse> {
    let analyzed = call(
        host,
        "workspace/analyze",
        json!({"revision":1,"sources":[
            {"uri":"symbols.harness","text":model},
            {"uri":"symbols.view.json","text":include_str!("../../../harness/models/symbols.view.json")}
        ]}),
    )?;
    assert_eq!(analyzed["clean"], true, "{analyzed}");
    let catalog = host.view_catalog(1)?;
    let view = catalog
        .views
        .iter()
        .find(|v| v.key == "symbols-1")
        .ok_or("Missing symbol view")?;
    let seeds = ["Alpha", "Beta"]
        .iter()
        .map(|name| {
            let owner = view
                .owners
                .iter()
                .find(|o| o.label == *name)
                .ok_or("Missing root")?;
            Ok(json!({"op":"addSeed","element":owner.key}))
        })
        .collect::<Result<Vec<_>>>()?;
    let scope = serde_json::from_value(json!({"schemaVersion":1,"ops":seeds}))?;
    Ok(host.view_scene(1, "symbols-1", Some(&scope), None)?)
}

#[test]
fn m14_source_text_is_bound_to_the_selected_stored_span_and_never_truncated() -> Result {
    let mut host = Host::new(intersect_view_harness::definition(), Box::new(NoCommands))?;
    let initialized = call(&mut host, "initialize", json!({"protocolVersion":2}))?;
    let mut candidate = input(
        initialized["language"]["fingerprint"]
            .as_str()
            .ok_or("Missing fingerprint")?,
        false,
    );
    let mut rules: Value = serde_json::from_str(
        candidate["resources"][1]["content"]
            .as_str()
            .ok_or("Missing rules")?,
    )?;
    rules["symbols"][0]["graphic"]["text"]["documentation"]["runs"][0]["label"] =
        json!({"parts":[{"id":"source","subject":{"kind":"self"},"text":{"sourceText":true}}]});
    rules["symbols"][0]["title"] = json!({"sourceText":true});
    let content = serde_json::to_string(&rules)?;
    candidate["resources"][1]["content"] = content.clone().into();
    candidate["manifests"][0]["resources"][1]["sha256"] = hash(&content).into();
    call(&mut host, "views/preparePresentation", candidate)?;
    let source = "space Symbols { kind Shared { field inherited = 9; } box Alpha : Shared {\r\n\tfield local = 1;\r\n} box Beta : Shared {} }";
    let response = scene_with_model(&mut host, source)?;
    let graph = response.scene.graph()?;
    let alpha = &graph.nodes[0];
    let part = &alpha
        .text
        .get("node.text.documentation")
        .ok_or("Missing source block")?
        .runs[0]
        .parts[0];
    assert_eq!(part.text, "box Alpha : Shared {\n    field local = 1;\n}");
    assert_eq!(alpha.title.text(), part.text.replace('\n', " "));
    assert_eq!(
        part.binding.as_ref().ok_or("Unbound source block")?.key,
        alpha.binding.key
    );
    assert_eq!(
        part.binding.as_ref().ok_or("Unbound source block")?.range,
        alpha.binding.range
    );
    assert_eq!(host.source("symbols.harness"), Some(source));
    let large = format!(
        "space Symbols {{ kind Shared {{ field inherited = 9; }} box Alpha : Shared {{ /*{}*/ }} box Beta : Shared {{}} }}",
        "x".repeat(4096)
    );
    let failure = scene_with_model(&mut host, &large)
        .err()
        .ok_or("Oversized source span was silently truncated")?;
    assert!(failure.to_string().contains("view.sourceText.span"));
    Ok(())
}

#[test]
fn m12_native_model_bindings_reuse_and_alternate_packages() -> Result {
    let mut fingerprints = Vec::new();
    for rotated in [false, true] {
        let (mut host, fingerprint) = prepared(rotated)?;
        fingerprints.push(fingerprint.clone());
        assert!(call(&mut host, "views/ruleSets", json!({})).is_err());
        assert!(
            call(
                &mut host,
                "views/ruleSets",
                json!({"presentationFingerprint":"0".repeat(64)})
            )
            .is_err()
        );
        assert_eq!(
            call(
                &mut host,
                "views/ruleSets",
                json!({"presentationFingerprint":fingerprint})
            )?["presentationFingerprint"],
            fingerprint
        );
        // The package guard must also admit abort's acknowledgement; aborting
        // without a candidate is harmless and must not invalidate the package.
        assert!(call(&mut host, "views/abortCommand", json!({"token":"absent"})).is_err());
        assert_eq!(
            call(
                &mut host,
                "views/abortCommand",
                json!({"token":"absent","presentationFingerprint":fingerprint})
            )?,
            json!({"presentationFingerprint":fingerprint})
        );
        let response = scene(&mut host)?;
        response.validate()?;
        assert_eq!(response.presentation.fingerprint, fingerprint);
        let graph = response.scene.graph()?;
        assert_eq!(graph.schema_version, 7);
        assert!(graph.problems.is_empty(), "{:?}", graph.problems);
        assert_eq!(graph.nodes.len(), 2);
        assert_eq!(graph.edges.len(), 2);
        let a = &graph.nodes[0];
        let b = &graph.nodes[1];
        assert_ne!(a.id, b.id);
        assert_eq!(
            a.graphic.as_ref().ok_or("No graphic")?.definition,
            "harness.symbols/structured"
        );
        let ar = &a.compartments[0].rows[0];
        let br = &b.compartments[0].rows[0];
        assert_ne!(ar.id, br.id);
        assert_eq!(ar.binding.key, br.binding.key);
        assert_ne!(ar.binding.context, br.binding.context);
        for node in &graph.nodes {
            let block = node
                .text
                .get("node.text.documentation")
                .ok_or("No evaluated text")?;
            let part = &block.runs[0].parts[0];
            assert!(part.text.contains('\n'));
            assert!(part.text.contains(&node.title.text()));
            assert_eq!(
                part.binding.as_ref().ok_or("No text binding")?.key,
                node.binding.key
            );
            assert_eq!(
                part.binding.as_ref().ok_or("No text binding")?.uri,
                "symbols.harness"
            );
            assert_eq!(node.ports.len(), 2);
            for port in &node.ports {
                assert_eq!(
                    port.graphic.as_ref().ok_or("No port graphic")?.parameters["angle"],
                    GraphicValue::Number(if rotated { 90.0 } else { 0.0 })
                );
            }
        }
        for edge in &graph.edges {
            assert!(edge.end_marker.is_some());
        }
        assert!(call(&mut host, "views/preparePresentation", json!({})).is_err());
    }
    assert_ne!(fingerprints[0], fingerprints[1]);
    Ok(())
}

#[test]
fn m12_bad_presentation_preparation_is_atomic() -> Result {
    let mut host = Host::new(intersect_view_harness::definition(), Box::new(NoCommands))?;
    assert!(call(&mut host, "initialize", json!({"protocolVersion":1})).is_err());
    let init = call(&mut host, "initialize", json!({"protocolVersion":2}))?;
    let fingerprint = init["language"]["fingerprint"]
        .as_str()
        .ok_or("No fingerprint")?;
    let good = input(fingerprint, false);
    let before = call(&mut host, "views/ruleSets", json!({}))?;
    let mut bad = good.clone();
    bad["manifests"][0]["resources"][0]["sha256"] = "0".repeat(64).into();
    assert!(call(&mut host, "views/preparePresentation", bad).is_err());
    assert_eq!(before, call(&mut host, "views/ruleSets", json!({}))?);
    let mut bad = good.clone();
    let mut rules: Value = serde_json::from_str(
        bad["resources"][1]["content"]
            .as_str()
            .ok_or("No rule source")?,
    )?;
    rules["symbols"][0]["graphic"]["text"]["documentation"]["runs"][0]["label"] =
        "notRegistered".into();
    let text = serde_json::to_string(&rules)?;
    bad["resources"][1]["content"] = text.clone().into();
    bad["manifests"][0]["resources"][1]["sha256"] = hash(&text).into();
    assert!(call(&mut host, "views/preparePresentation", bad).is_err());
    assert_eq!(before, call(&mut host, "views/ruleSets", json!({}))?);
    call(&mut host, "views/preparePresentation", good)?;
    scene(&mut host)?.validate()?;
    Ok(())
}

fn boundary_input(count: usize, padding: usize) -> Result<intersect_views::PresentationInput> {
    let resources=(0..count).map(|i|json!({"id":format!("resource-{i}"),"content":if i==0{"x".repeat(padding)}else{String::new()}})).collect::<Vec<_>>();
    let refs=resources.iter().map(|r|Ok(json!({"id":r["id"],"kind":"symbolLibrary","sha256":hash(r["content"].as_str().ok_or("No resource content")?)}))).collect::<Result<Vec<_>>>()?;
    Ok(serde_json::from_value(
        json!({"root":"limit@1","manifests":[{"schemaVersion":1,"id":"limit","version":"1","language":"fixture","languageFingerprint":"1".repeat(64),"requires":[],"dependencies":[],"resources":refs}],"resources":resources}),
    )?)
}
#[test]
fn m12_package_resource_and_exact_byte_boundaries() -> Result {
    let resolve = |input: &intersect_views::PresentationInput| {
        input
            .resolve("fixture", &"1".repeat(64), &|bytes| {
                format!("{:x}", Sha256::digest(bytes))
            })
            .map(|_| ())
    };
    resolve(&boundary_input(64, 0)?)?;
    assert!(resolve(&boundary_input(65, 0)?).is_err());
    let empty = boundary_input(1, 0)?;
    let limit = 2 * 1024 * 1024;
    let padding = limit - serde_json::to_vec(&empty)?.len();
    let accepted = boundary_input(1, padding)?;
    assert_eq!(serde_json::to_vec(&accepted)?.len(), limit);
    resolve(&accepted)?;
    assert!(resolve(&boundary_input(1, padding + 1)?).is_err());
    Ok(())
}

#[test]
fn m13_registry_admission_is_atomic_and_requires_its_capability() -> Result {
    let mut host = Host::new(intersect_view_harness::definition(), Box::new(NoCommands))?;
    let init = call(&mut host, "initialize", json!({"protocolVersion":2}))?;
    let mut package = input(
        init["language"]["fingerprint"]
            .as_str()
            .ok_or("No fingerprint")?,
        false,
    );
    let registry = json!({"schemaVersion":1,"id":"fixture.registry","registrations":[{"id":"fixture.symbols","ruleSetId":"harness.symbols","projectionPolicy":{"kind":"nested"}}]});
    let content = registry.to_string();
    package["resources"]
        .as_array_mut()
        .ok_or("No resources")?
        .push(json!({"id":"registry","content":content}));
    package["manifests"][0]["resources"]
        .as_array_mut()
        .ok_or("No refs")?
        .push(json!({"id":"registry","kind":"renderingRegistry","sha256":hash(&content)}));
    assert!(call(&mut host, "views/preparePresentation", package.clone()).is_err());
    package["manifests"][0]["requires"]
        .as_array_mut()
        .ok_or("No capabilities")?
        .push("views.rendering.v1".into());
    for invalid in [
        json!({"kind":"containmentTree","edgeRole":"child","edgeNotation":"line"}),
        json!({"kind":"unknown"}),
    ] {
        let mut candidate = package.clone();
        let mut invalid_registry = registry.clone();
        invalid_registry["registrations"][0]["projectionPolicy"] = invalid;
        let content = invalid_registry.to_string();
        candidate["resources"][3]["content"] = content.clone().into();
        candidate["manifests"][0]["resources"][3]["sha256"] = hash(&content).into();
        assert!(call(&mut host, "views/preparePresentation", candidate).is_err());
    }
    let accepted = call(&mut host, "views/preparePresentation", package)?;
    assert!(
        accepted["ruleSets"]
            .as_array()
            .ok_or("No rules")?
            .iter()
            .any(|id| id == "harness.symbols")
    );
    assert!(scene(&mut host)?.scene.graph()?.problems.is_empty());
    Ok(())
}
