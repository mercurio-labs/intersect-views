use intersect_view_host::{Host, Source};
use serde_json::{Value, json};
fn call(h: &mut Host, method: &str, params: Value) -> Result<Value, String> {
    h.dispatch(json!({"method":method,"params":params}))
}
pub fn run() -> Result<(), String> {
    let mut h = Host::new(
        intersect_view_harness::definition(),
        Box::new(intersect_view_harness::HarnessCommands),
    )?;
    let text = "// 🌕 café\r\nspace Process {\r\n lane Operator; lane Controller;\r\n step Start in Operator;\r\n step Activity in Operator after /* keep after */ Start end Finish across Controller;\r\n step Check in Controller after Start;\r\n step Finish in Operator after Check;\r\n}\r\n";
    let doc=json!({"schemaVersion":1,"key":"lanes","name":"Lanes","ruleSet":"harness.lanes-horizontal","scope":{"schemaVersion":1,"ops":[]}}).to_string();
    let mut sources = vec![
        Source {
            uri: "process.harness".into(),
            text: text.into(),
        },
        Source {
            uri: "lanes.view.json".into(),
            text: doc,
        },
    ];
    sources.push(Source{uri:"vertical.view.json".into(),text:json!({"schemaVersion":1,"key":"vertical","name":"Vertical","ruleSet":"harness.lanes-vertical","scope":{"schemaVersion":1,"ops":[]}}).to_string()});
    let analysis = call(
        &mut h,
        "workspace/analyze",
        json!({"revision":1,"sources":sources}),
    )?;
    if analysis["clean"] != true {
        return Err(format!("Lane gate analysis: {analysis}"));
    }
    let catalog = call(&mut h, "views/catalog", json!({"revision":1}))?;
    let owner = catalog["views"][0]["owners"]
        .as_array()
        .ok_or("No owners")?
        .iter()
        .find(|o| o["label"] == "Process")
        .ok_or("No Space")?["key"]
        .clone();
    let scope = json!({"schemaVersion":1,"ops":[{"op":"addSeed","element":owner}]});
    let params = json!({"revision":1,"viewKey":"lanes","scope":scope});
    let scene = call(&mut h, "views/scene", params.clone())?;
    if scene != call(&mut h, "views/scene", params)? {
        return Err("Nondeterministic lane scene".into());
    }
    let scene = &scene["scene"];
    let steps = scene["steps"].as_array().ok_or("No steps")?;
    if steps.len() != 4
        || scene["lanes"].as_array().ok_or("No lanes")?.len() != 2
        || scene["spans"].as_array().ok_or("No spans")?.len() != 1
        || steps[1]["unordered"] != true
        || steps[2]["unordered"] != true
    {
        return Err(format!("Lane gate constraints mismatch: {scene}"));
    }
    let vertical = call(
        &mut h,
        "views/scene",
        json!({"revision":1,"viewKey":"vertical","scope":scope}),
    )?;
    if vertical["scene"]["axis"]["direction"] != "vertical"
        || vertical["scene"]["steps"]
            .as_array()
            .ok_or("No vertical steps")?
            .iter()
            .map(|s| &s["rank"])
            .collect::<Vec<_>>()
            != steps.iter().map(|s| &s["rank"]).collect::<Vec<_>>()
    {
        return Err("Semantic orientation changed ranks".into());
    }
    let hint = json!({"revision":1,"viewKey":"lanes","toolId":"place-step","step":steps[2]["id"],"lane":scene["lanes"][0]["id"],"before":steps[1]["id"],"end":null,"scope":scope});
    if call(&mut h, "views/laneTargets", hint.clone())?["enabled"] != true {
        return Err("Lane target refused".into());
    }

    for (field, value) in [
        ("revision", json!(0)),
        ("step", json!("missing")),
        ("lane", json!("missing")),
        ("before", steps[2]["id"].clone()),
        ("end", steps[2]["id"].clone()),
    ] {
        let mut bad = hint.clone();
        bad[field] = value;
        if call(&mut h, "views/laneTargets", bad).is_ok() {
            return Err(format!("Lane hint accepted invalid {field}"));
        }
    }
    let mut missing = hint.clone();
    missing
        .as_object_mut()
        .ok_or("No hint object")?
        .remove("before");
    if call(&mut h, "views/laneTargets", missing).is_ok() {
        return Err("Missing nullable lane target accepted".into());
    }
    let mut unsupported = hint.clone();
    unsupported["toolId"] = json!("box");
    let disabled = call(&mut h, "views/laneTargets", unsupported)?;
    if disabled["enabled"] != false || disabled["reason"].as_str().is_none_or(str::is_empty) {
        return Err("Wrong lane tool not explicitly disabled".into());
    }
    let valid = json!({"revision":1,"viewKey":"lanes","toolId":"place-step","ownerKey":steps[2]["binding"]["key"],"scope":scope,"arguments":{"step":hint["step"],"lane":hint["lane"],"before":hint["before"],"end":""}});
    let mut wrong = valid.clone();
    wrong["ownerKey"] = json!("missing");
    if call(&mut h, "views/prepareCommand", wrong)?["code"].is_null() {
        return Err("Wrong lane owner accepted".into());
    }
    let mut backward = valid.clone();
    backward["arguments"]["end"] = steps[0]["id"].clone();
    if call(&mut h, "views/prepareCommand", backward)?["code"] != "harness.lane" {
        return Err("Backward span provider refusal missing".into());
    }
    if call(
        &mut h,
        "intersect/source",
        json!({"uri":"process.harness","revision":1}),
    )?["text"]
        != text
    {
        return Err("Rejected placement changed accepted source".into());
    }
    let aborted = call(&mut h, "views/prepareCommand", valid.clone())?;
    call(
        &mut h,
        "views/abortCommand",
        json!({"token":aborted["token"]}),
    )?;
    if call(
        &mut h,
        "views/commitCommand",
        json!({"revision":1,"token":aborted["token"],"sources":sources}),
    )
    .is_ok()
    {
        return Err("Aborted lane token accepted".into());
    }
    let prepared = call(
        &mut h,
        "views/prepareCommand",
        json!({"revision":1,"viewKey":"lanes","toolId":"place-step","ownerKey":steps[2]["binding"]["key"],"scope":scope,"arguments":{"step":hint["step"],"lane":hint["lane"],"before":hint["before"],"end":""}}),
    )?;
    if prepared["token"] == aborted["token"] {
        return Err("Lane token reused after abort".into());
    }
    if call(&mut h, "views/prepareCommand", valid)?["code"] != "edit.pending" {
        return Err("Second lane pending edit accepted".into());
    }
    if call(
        &mut h,
        "views/commitCommand",
        json!({"revision":1,"token":prepared["token"],"sources":sources}),
    )
    .is_ok()
    {
        return Err("Unapplied lane receipt accepted".into());
    }
    call(
        &mut h,
        "views/abortCommand",
        json!({"token":"edit:1:wrong"}),
    )?;
    let patch = &prepared["patches"][0];
    let replacement = patch["replacement"]
        .as_str()
        .ok_or_else(|| format!("Lane prepare: {prepared}"))?;
    if !replacement.contains("/* keep after */")
        || !replacement.contains("// 🌕 café\r\n")
        || !replacement.contains("step Check in Operator after Start")
    {
        return Err(format!("Lane source preservation failed: {replacement}"));
    }
    sources[0].text = replacement.into();
    let committed = call(
        &mut h,
        "views/commitCommand",
        json!({"revision":1,"token":prepared["token"],"sources":sources}),
    )?;
    if committed["clean"] != true {
        return Err(format!("Lane commit: {committed}"));
    }
    let next = call(
        &mut h,
        "views/scene",
        json!({"revision":2,"viewKey":"lanes","scope":scope}),
    )?;
    let actual = next["scene"]["steps"]
        .as_array()
        .ok_or("No committed steps")?;
    if actual[2]["rank"] != 1
        || actual[1]["rank"] != 2
        || actual.iter().any(|s| s["unordered"] != false)
    {
        return Err(format!("Lane command rank mismatch: {next}"));
    }
    if call(&mut h, "views/laneTargets", hint).is_ok() {
        return Err("Stale lane hints accepted after commit".into());
    }
    Ok(())
}
