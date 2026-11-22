//! Small actual-host probe shared by the native and WASM M8 gates.
use intersect_view_host::{Host, NoCommands};
use intersect_views::SceneResponse;
use serde_json::json;
pub fn regions() -> Result<SceneResponse, String> {
    let mut host = Host::new(crate::definition(), Box::new(NoCommands))?;
    let a=host.dispatch(json!({"method":"workspace/analyze","params":{"revision":1,"sources":[{"uri":"regions.harness","text":include_str!("../models/regions.harness")},{"uri":"regions.view.json","text":json!({"schemaVersion":1,"key":"regions","name":"Regions","ruleSet":"harness.regions","scope":{"schemaVersion":1,"ops":[]}}).to_string()}]}}))?;
    if a["clean"] != true || a["resolved"] != a["references"] {
        return Err(format!("M8 analysis: {a}"));
    }
    let catalog = host.dispatch(json!({"method":"views/catalog","params":{"revision":1}}))?;
    let owners = catalog["views"][0]["owners"]
        .as_array()
        .ok_or("Missing owners")?;
    let ops = ["Alpha", "Beta"]
        .into_iter()
        .map(|name| {
            owners
                .iter()
                .find(|o| o["label"] == name)
                .map(|o| json!({"op":"addSeed","element":o["key"]}))
                .ok_or("Missing owner")
        })
        .collect::<Result<Vec<_>, _>>()?;
    let response:SceneResponse=serde_json::from_value(host.dispatch(json!({"method":"views/scene","params":{"revision":1,"viewKey":"regions","scope":{"schemaVersion":1,"ops":ops}}}))?).map_err(|e|e.to_string())?;
    response.validate()?;
    let graph = response.scene.graph()?;
    if graph.nodes.len() != 2 || graph.edges.len() != 2 {
        return Err("M8 occurrence/edge count mismatch".into());
    }
    let left = graph.nodes[0]
        .regions
        .as_ref()
        .and_then(|r| r.items.first())
        .ok_or("Missing first region")?;
    let repeated = graph.nodes[1]
        .regions
        .as_ref()
        .and_then(|r| r.items.first())
        .ok_or("Missing repeated region")?;
    if left.id == repeated.id
        || left.binding.key != repeated.binding.key
        || left.children[0].id == repeated.children[0].id
        || left.children[0].binding.key != repeated.children[0].binding.key
    {
        return Err("M8 region occurrence identity mismatch".into());
    }
    if graph.edges[0].source != left.children[0].ports[0].id
        || graph.edges[1].source != repeated.children[0].ports[0].id
    {
        return Err("M8 group path endpoint mismatch".into());
    }
    if graph.nodes[0].title.parts.len() != 2
        || graph.nodes[0].title.parts[0]
            .binding
            .as_ref()
            .map(|b| &b.key)
            == graph.nodes[0].title.parts[1]
                .binding
                .as_ref()
                .map(|b| &b.key)
    {
        return Err("M8 separate label bindings missing".into());
    }
    Ok(response)
}
