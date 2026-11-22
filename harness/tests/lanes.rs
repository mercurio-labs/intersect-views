#[path = "support/lane_gate.rs"]
mod gate;
#[test]
fn native_lane_source_command_gate() -> Result<(), String> {
    gate::run()
}

#[test]
fn placement_preserves_keyword_names_and_comments() -> Result<(), String> {
    use intersect_view_host::Host;
    use serde_json::{Value, json};
    let mut host = Host::new(
        intersect_view_harness::definition(),
        Box::new(intersect_view_harness::HarnessCommands),
    )?;
    let call = |h: &mut Host, method: &str, params: Value| {
        h.dispatch(json!({"method":method,"params":params}))
    };
    let text = "space Escaped { lane after; lane Other; step end in after; step Mid in Other after /* keep */ end; step Finish in after after Mid; }";
    let doc=json!({"schemaVersion":1,"key":"lanes","name":"Lanes","ruleSet":"harness.lanes-horizontal","scope":{"schemaVersion":1,"ops":[]}}).to_string();
    let analysis = call(
        &mut host,
        "workspace/analyze",
        json!({"revision":1,"sources":[{"uri":"escaped.harness","text":text},{"uri":"lanes.view.json","text":doc}]}),
    )?;
    if analysis["clean"] != true {
        return Err(format!("{analysis}"));
    }
    let catalog = call(&mut host, "views/catalog", json!({"revision":1}))?;
    let owner = catalog["views"][0]["owners"]
        .as_array()
        .ok_or("No owners")?
        .iter()
        .find(|o| o["label"] == "Escaped")
        .ok_or("No Space")?["key"]
        .clone();
    let scope = json!({"schemaVersion":1,"ops":[{"op":"addSeed","element":owner}]});
    let response = call(
        &mut host,
        "views/scene",
        json!({"revision":1,"viewKey":"lanes","scope":scope}),
    )?;
    let scene = &response["scene"];
    let step = &scene["steps"][1];
    let prepared = call(
        &mut host,
        "views/prepareCommand",
        json!({"revision":1,"viewKey":"lanes","toolId":"place-step","ownerKey":step["binding"]["key"],"scope":scope,"arguments":{"step":step["id"],"lane":scene["lanes"][0]["id"],"before":scene["steps"][2]["id"],"end":""}}),
    )?;
    let source = prepared["patches"][0]["replacement"]
        .as_str()
        .ok_or_else(|| format!("{prepared}"))?;
    if !source.contains("step end in after;")
        || !source.contains("step Mid in after after end")
        || source.matches("/* keep */").count() != 1
    {
        return Err(format!("Keyword source was not preserved: {source}"));
    }
    Ok(())
}
