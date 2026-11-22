use intersect_model::definitions::bundle::DefinitionSource;
use intersect_view_host::{Host, NoCommands};
use serde_json::{Value, json};
type Result = std::result::Result<(), Box<dyn std::error::Error>>;
fn modify(
    pointer: &str,
    value: Value,
) -> std::result::Result<intersect_view_host::LanguageDefinition, Box<dyn std::error::Error>> {
    let mut d = intersect_view_harness::definition();
    let index = d
        .rule_sets
        .iter()
        .position(|s| s.contains("harness.lanes-horizontal"))
        .ok_or("No lane rules")?;
    let mut r: Value = serde_json::from_str(&d.rule_sets[index])?;
    *r.pointer_mut(pointer).ok_or("No lane slot")? = value;
    d.rule_sets[index] = r.to_string();
    Ok(d)
}
#[test]
fn every_lane_selector_and_nested_label_is_checked_before_empty_scope() -> Result {
    for pointer in [
        "/laneGraph/container/lanes",
        "/laneGraph/container/steps",
        "/laneGraph/step/lane",
        "/laneGraph/step/after",
        "/laneGraph/step/end",
        "/laneGraph/step/across",
        "/laneGraph/lane/label/parts/1/text",
        "/laneGraph/step/label/parts/1/text",
        "/laneGraph/edit/accepts",
    ] {
        let error = Host::new(
            modify(pointer, json!("missingLaneFunction"))?,
            Box::new(NoCommands),
        )
        .err()
        .ok_or("Missing lane function accepted")?;
        assert!(error.contains("missingLaneFunction"), "{pointer}: {error}");
    }
    Ok(())
}
#[test]
fn lane_initialization_refuses_wrong_signatures_and_construction() -> Result {
    for (pointer, name) in [
        ("/laneGraph/step/lane", "stepAfter"),
        ("/laneGraph/step/end", "stepLane"),
        ("/laneGraph/lane/label/parts/1/text", "canPlaceStep"),
        ("/laneGraph/edit/accepts", "stepLabel"),
    ] {
        assert!(
            Host::new(modify(pointer, json!(name))?, Box::new(NoCommands)).is_err(),
            "{pointer}"
        );
    }
    let mut d = modify(
        "/laneGraph/step/label/parts/1/text",
        json!("constructingStepLabel"),
    )?;
    let old = &d.view_functions[1];
    let mut source = DefinitionSource::new(
        &old.id.uri,
        old.kind,
        format!(
            "{}\npub fn constructingStepLabel(self:h.Step)->String {{ let field:h.Field = new h.Field {{ name:self.name, value:1 }}; field.name }}",
            old.text
        ),
    );
    source.dependencies = old.dependencies.clone();
    d.view_functions[1] = source;
    let error = Host::new(d, Box::new(NoCommands))
        .err()
        .ok_or("Constructing lane function accepted")?;
    assert!(error.contains("constructing"), "{error}");
    Ok(())
}

#[test]
fn visible_foreign_container_ids_are_refused_by_host_targets_and_prepare() -> Result {
    let mut h = Host::new(
        intersect_view_harness::definition(),
        Box::new(intersect_view_harness::HarnessCommands),
    )?;
    let call = |h: &mut Host, method: &str, params: Value| {
        h.dispatch(json!({"method":method,"params":params}))
    };
    // Harness sources each have one lexical Space; two source files make both visible.
    let sources = json!([{ "uri":"one.harness","text":"space One {lane A;step Start in A;}"},{"uri":"two.harness","text":"space Two {lane B;step Finish in B;}"},{"uri":"lanes.view.json","text":json!({"schemaVersion":1,"key":"lanes","name":"Lanes","ruleSet":"harness.lanes-horizontal","scope":{"schemaVersion":1,"ops":[]}}).to_string()}]);
    let analysis = call(
        &mut h,
        "workspace/analyze",
        json!({"revision":1,"sources":sources}),
    )?;
    assert_eq!(analysis["clean"], true, "{analysis}");
    let catalog = call(&mut h, "views/catalog", json!({"revision":1}))?;
    let owners = catalog["views"][0]["owners"]
        .as_array()
        .ok_or("No owners")?;
    let key = |name: &str| {
        owners
            .iter()
            .find(|o| o["label"] == name)
            .map(|o| o["key"].clone())
            .ok_or("No container")
    };
    let scope = json!({"schemaVersion":1,"ops":[{"op":"addSeed","element":key("One")?},{"op":"addSeed","element":key("Two")?}]});
    let response = call(
        &mut h,
        "views/scene",
        json!({"revision":1,"viewKey":"lanes","scope":scope}),
    )?;
    let scene = &response["scene"];
    let hint = json!({"revision":1,"viewKey":"lanes","toolId":"place-step","step":scene["steps"][0]["id"],"lane":scene["lanes"][0]["id"],"before":null,"end":null,"scope":scope});
    for (field, value) in [
        ("lane", scene["lanes"][1]["id"].clone()),
        ("before", scene["steps"][1]["id"].clone()),
        ("end", scene["steps"][1]["id"].clone()),
    ] {
        let mut invalid = hint.clone();
        invalid[field] = value;
        assert!(
            call(&mut h, "views/laneTargets", invalid).is_err(),
            "{field}"
        );
    }
    let bad = call(
        &mut h,
        "views/prepareCommand",
        json!({"revision":1,"viewKey":"lanes","toolId":"place-step","ownerKey":scene["steps"][0]["binding"]["key"],"scope":scope,"arguments":{"step":scene["steps"][0]["id"],"lane":scene["lanes"][1]["id"],"before":"","end":""}}),
    )?;
    assert!(bad["code"].is_string());
    assert_eq!(
        call(&mut h, "intersect/source", json!({"uri":"one.harness"}))?["text"],
        sources[0]["text"]
    );
    Ok(())
}

#[test]
fn lane_without_an_authored_palette_derives_its_registered_edit_tool() -> Result {
    let mut d = intersect_view_harness::definition();
    d.palette.clear();
    let mut h = Host::new(d, Box::new(intersect_view_harness::HarnessCommands))?;
    let request = json!({"method":"workspace/analyze","params":{"revision":1,"sources":[{"uri":"one.harness","text":"space One {lane A;step Start in A;}"},{"uri":"lanes.view.json","text":json!({"schemaVersion":1,"key":"lanes","name":"Lanes","ruleSet":"harness.lanes-horizontal","scope":{"schemaVersion":1,"ops":[]}}).to_string()}]}});
    assert_eq!(h.dispatch(request)?["clean"], true);
    let response =
        h.dispatch(json!({"method":"views/scene","params":{"revision":1,"viewKey":"lanes"}}))?;
    let tool = &response["scene"]["palette"]["groups"][0]["entries"][1];
    assert_eq!(tool["id"], "place-step");
    assert_eq!(tool["parameters"]["placement"], "lane");
    assert_eq!(response["capabilities"][1]["enabled"], true);
    Ok(())
}
