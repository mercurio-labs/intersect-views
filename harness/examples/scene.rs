//! Export a real host scene for cross-language wire validation.
use intersect_view_host::{Host, NoCommands};
use serde_json::{Value, json};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut host = Host::new(intersect_view_harness::definition(), Box::new(NoCommands))?;
    host.dispatch(
        json!({"method":"workspace/analyze","params":{"revision":1,"sources":[
        {"uri":"structure.harness","text":include_str!("../models/structure.harness")},
        {"uri":"structure.view.json","text":include_str!("../models/structure.view.json")}]}}),
    )?;
    let catalog = host.dispatch(json!({"method":"views/catalog","params":{"revision":1}}))?;
    let view = &catalog["views"][0];
    let ops: Vec<Value> = view["owners"]
        .as_array()
        .ok_or("No owners")?
        .iter()
        .filter(|o| o["label"] == "Alpha" || o["label"] == "Beta")
        .map(|o| json!({"op":"addSeed","element":o["key"]}))
        .collect();
    let scene=host.dispatch(json!({"method":"views/scene","params":{"revision":1,"viewKey":view["key"],"scope":{"schemaVersion":1,"ops":ops}}}))?;
    println!("{}", serde_json::to_string_pretty(&scene)?);
    Ok(())
}
